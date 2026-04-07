import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
    createProjectViaApi,
    createTaskViaApi,
    createTimeEntryOnDateViaApi,
    type TestContext,
} from './utils/api';

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

async function goToTimesheet(page: Page) {
    await page.goto(PLAYWRIGHT_BASE_URL + '/timesheet');
}

function getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getCurrentWeekMonday(): Date {
    return getMonday(new Date());
}

function getLastWeekMonday(): Date {
    const monday = getCurrentWeekMonday();
    monday.setDate(monday.getDate() - 7);
    return monday;
}

function getDayOfWeek(weekStart: Date, dayOffset: number): Date {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + dayOffset);
    return date;
}

async function waitForTimesheetLoad(page: Page) {
    await page.waitForResponse(
        (response) => response.url().includes('/time-entries') && response.status() === 200
    );
}

// ──────────────────────────────────────────────────
// Navigation & Page Load
// ──────────────────────────────────────────────────

test('timesheet page loads and shows in sidebar navigation', async ({ page }) => {
    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    await expect(page.locator('[data-testid="timesheet_view"]')).toBeVisible();
    await expect(page.getByTestId('timesheet_week_display')).toBeVisible();
    await expect(page.getByText('Project', { exact: false })).toBeVisible();
    await expect(page.getByText('Total').first()).toBeVisible();
});

test('timesheet shows empty state when no entries exist', async ({ page }) => {
    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    await expect(page.getByText('No time entries this week')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add row/i })).toBeVisible();
    // Copy last week dropdown trigger is below the table
    await expect(page.getByRole('button', { name: /Copy last week/i })).toBeVisible();
});

// ──────────────────────────────────────────────────
// Display Existing Time Entries
// ──────────────────────────────────────────────────

test('timesheet displays existing time entries grouped by project', async ({ page, ctx }) => {
    const monday = getCurrentWeekMonday();
    const tuesday = getDayOfWeek(monday, 1);
    const wednesday = getDayOfWeek(monday, 2);

    const projectA = await createProjectViaApi(ctx, { name: 'Project Alpha' });
    const projectB = await createProjectViaApi(ctx, { name: 'Project Beta' });

    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '2h',
        projectId: projectA.id,
    });
    await createTimeEntryOnDateViaApi(ctx, {
        date: wednesday,
        duration: '1h',
        projectId: projectA.id,
    });
    await createTimeEntryOnDateViaApi(ctx, {
        date: tuesday,
        duration: '3h',
        projectId: projectB.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(2);

    // Check that the grand total is shown
    await expect(page.getByTestId('timesheet_grand_total')).toBeVisible();
});

test('timesheet groups entries by project and task combination', async ({ page, ctx }) => {
    const monday = getCurrentWeekMonday();

    const project = await createProjectViaApi(ctx, { name: 'Task Project' });
    const taskA = await createTaskViaApi(ctx, { name: 'Task A', project_id: project.id });
    const taskB = await createTaskViaApi(ctx, { name: 'Task B', project_id: project.id });

    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '1h',
        projectId: project.id,
        taskId: taskA.id,
    });
    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '2h',
        projectId: project.id,
        taskId: taskB.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(2);
});

// ──────────────────────────────────────────────────
// Add Row
// ──────────────────────────────────────────────────

test('can add a new row', async ({ page }) => {
    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    await page.getByRole('button', { name: /Add row/i }).first().click();

    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(1);
});

// ──────────────────────────────────────────────────
// Enter Duration in Cell
// ──────────────────────────────────────────────────

test('entering duration in empty cell creates a time entry', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, { name: 'Duration Test' });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Add a row
    await page.getByRole('button', { name: /Add row/i }).first().click();

    // Select the project in the new row
    const row = page.locator('[data-testid="timesheet_row"]').first();
    // The project dropdown should be within the row
    // Click the project selector (it should show "No Project" or similar)
    await row.locator('[data-testid="timesheet_row"] >> nth=0').or(row).getByText('No Project').click();

    // Wait for dropdown and select project
    await page.getByText('Duration Test').click();

    // Click the first day cell and enter duration
    const cells = row.locator('[data-testid="timesheet_cell"]');
    const mondayCell = cells.first();
    const mondayInput = mondayCell.locator('input');

    await mondayInput.click();
    await mondayInput.fill('2');

    // Submit and wait for create response
    const [response] = await Promise.all([
        page.waitForResponse(
            (resp) =>
                resp.url().includes('/time-entries') &&
                resp.request().method() === 'POST' &&
                resp.status() === 201
        ),
        mondayInput.press('Enter'),
    ]);

    expect(response.status()).toBe(201);

    // Verify the cell shows the duration
    await expect(mondayInput).not.toHaveValue('');
});

// ──────────────────────────────────────────────────
// Edit Duration (Increase)
// ──────────────────────────────────────────────────

test('increasing duration in cell extends the last time entry', async ({ page, ctx }) => {
    const monday = getCurrentWeekMonday();
    const project = await createProjectViaApi(ctx, { name: 'Increase Test' });

    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '1h',
        projectId: project.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    const row = page.locator('[data-testid="timesheet_row"]').first();
    const cells = row.locator('[data-testid="timesheet_cell"]');
    const mondayInput = cells.first().locator('input');

    // Click and change to 3 hours
    await mondayInput.click();
    await mondayInput.fill('3');

    const [response] = await Promise.all([
        page.waitForResponse(
            (resp) =>
                resp.url().includes('/time-entries') &&
                resp.request().method() === 'PUT' &&
                resp.status() === 200
        ),
        mondayInput.press('Enter'),
    ]);

    expect(response.status()).toBe(200);
});

// ──────────────────────────────────────────────────
// Edit Duration (Decrease)
// ──────────────────────────────────────────────────

test('decreasing duration in cell shortens the last time entry', async ({ page, ctx }) => {
    const monday = getCurrentWeekMonday();
    const project = await createProjectViaApi(ctx, { name: 'Decrease Test' });

    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '3h',
        projectId: project.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    const row = page.locator('[data-testid="timesheet_row"]').first();
    const cells = row.locator('[data-testid="timesheet_cell"]');
    const mondayInput = cells.first().locator('input');

    await mondayInput.click();
    await mondayInput.fill('1');

    const [response] = await Promise.all([
        page.waitForResponse(
            (resp) =>
                resp.url().includes('/time-entries') &&
                resp.request().method() === 'PUT' &&
                resp.status() === 200
        ),
        mondayInput.press('Enter'),
    ]);

    expect(response.status()).toBe(200);
});

// ──────────────────────────────────────────────────
// Clear Cell
// ──────────────────────────────────────────────────

test('clearing a cell deletes all time entries for that project+day', async ({ page, ctx }) => {
    const monday = getCurrentWeekMonday();
    const project = await createProjectViaApi(ctx, { name: 'Clear Test' });

    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '2h',
        projectId: project.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    const row = page.locator('[data-testid="timesheet_row"]').first();
    const cells = row.locator('[data-testid="timesheet_cell"]');
    const mondayInput = cells.first().locator('input');

    await mondayInput.click();
    await mondayInput.fill('0');

    const [response] = await Promise.all([
        page.waitForResponse(
            (resp) =>
                resp.url().includes('/time-entries') &&
                resp.request().method() === 'DELETE' &&
                resp.status() === 200
        ),
        mondayInput.press('Enter'),
    ]);

    expect(response.status()).toBe(200);
});

// ──────────────────────────────────────────────────
// Week Navigation
// ──────────────────────────────────────────────────

test('navigating to previous week shows entries from that week', async ({ page, ctx }) => {
    const lastMonday = getLastWeekMonday();
    const project = await createProjectViaApi(ctx, { name: 'Last Week Project' });

    await createTimeEntryOnDateViaApi(ctx, {
        date: lastMonday,
        duration: '2h',
        projectId: project.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Current week should have no entries
    await expect(page.getByText('No time entries this week')).toBeVisible();

    // Go to previous week
    await Promise.all([
        page.waitForResponse(
            (resp) => resp.url().includes('/time-entries') && resp.status() === 200
        ),
        page.getByTestId('timesheet_prev_week').click(),
    ]);

    // Should now see the entry
    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(1);
});

test('can navigate forward and return to current week', async ({ page }) => {
    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Should show "This week"
    await expect(page.getByTestId('timesheet_week_display')).toContainText('This week');

    // Go to next week
    await Promise.all([
        page.waitForResponse(
            (resp) => resp.url().includes('/time-entries') && resp.status() === 200
        ),
        page.getByTestId('timesheet_next_week').click(),
    ]);

    // Should no longer show "This week"
    await expect(page.getByTestId('timesheet_week_display')).not.toContainText('This week');

    // Go back to this week
    await Promise.all([
        page.waitForResponse(
            (resp) => resp.url().includes('/time-entries') && resp.status() === 200
        ),
        page.getByTestId('timesheet_week_display').click(),
    ]);

    await expect(page.getByTestId('timesheet_week_display')).toContainText('This week');
});

// ──────────────────────────────────────────────────
// Copy Last Week
// ──────────────────────────────────────────────────

test('copy last week adds project rows from previous week without hours', async ({
    page,
    ctx,
}) => {
    const lastMonday = getLastWeekMonday();
    const lastWednesday = getDayOfWeek(lastMonday, 2);

    const projectA = await createProjectViaApi(ctx, { name: 'Copy Project A' });
    const projectB = await createProjectViaApi(ctx, { name: 'Copy Project B' });

    await createTimeEntryOnDateViaApi(ctx, {
        date: lastMonday,
        duration: '2h',
        projectId: projectA.id,
    });
    await createTimeEntryOnDateViaApi(ctx, {
        date: lastWednesday,
        duration: '3h',
        projectId: projectB.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Current week should be empty
    await expect(page.getByText('No time entries this week')).toBeVisible();

    // Open copy last week dropdown and click "Copy rows only"
    await page.getByRole('button', { name: /Copy last week/i }).click();
    await page.getByText('Copy rows only').click();

    // Should now show 2 rows (one per project)
    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(2);

    // All row totals should be 0
    const rowTotals = page.locator('[data-testid="timesheet_row_total"]');
    const count = await rowTotals.count();
    for (let i = 0; i < count; i++) {
        await expect(rowTotals.nth(i)).toContainText('0');
    }
});

test('copy last week does not duplicate rows that already exist', async ({ page, ctx }) => {
    const lastMonday = getLastWeekMonday();
    const thisMonday = getCurrentWeekMonday();
    const thisTuesday = getDayOfWeek(thisMonday, 1);

    const project = await createProjectViaApi(ctx, { name: 'No Dup Project' });

    // Create entry for last week
    await createTimeEntryOnDateViaApi(ctx, {
        date: lastMonday,
        duration: '2h',
        projectId: project.id,
    });

    // Create entry for current week
    await createTimeEntryOnDateViaApi(ctx, {
        date: thisTuesday,
        duration: '1h',
        projectId: project.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Should have 1 row (from current week entry)
    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(1);

    // Open copy last week dropdown and click "Copy rows only"
    await page.getByRole('button', { name: /Copy last week/i }).click();
    await page.getByText('Copy rows only').click();

    // Should still have only 1 row (not duplicated)
    await expect(rows).toHaveCount(1);
});

test('copy last week with time entries creates rows and entries', async ({ page, ctx }) => {
    const lastMonday = getLastWeekMonday();

    const project = await createProjectViaApi(ctx, { name: 'Copy Time Project' });

    await createTimeEntryOnDateViaApi(ctx, {
        date: lastMonday,
        duration: '2h',
        projectId: project.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Current week should be empty
    await expect(page.getByText('No time entries this week')).toBeVisible();

    // Open copy last week dropdown and click "Copy rows and time entries"
    await page.getByRole('button', { name: /Copy last week/i }).click();

    await Promise.all([
        page.waitForResponse(
            (resp) =>
                resp.url().includes('/time-entries') &&
                resp.request().method() === 'POST' &&
                resp.status() === 201
        ),
        page.getByText('Copy rows and time entries').click(),
    ]);

    // Should now show 1 row with time entries
    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(1);

    // Row total should not be 0 (entries were copied)
    const rowTotal = page.locator('[data-testid="timesheet_row_total"]').first();
    await expect(rowTotal).not.toContainText('0 h');
});

// ──────────────────────────────────────────────────
// Row Removal
// ──────────────────────────────────────────────────

test('can remove an empty row without confirmation', async ({ page }) => {
    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Add a row
    await page.getByRole('button', { name: /Add row/i }).first().click();

    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(1);

    // Hover the row to reveal the X button, then click it
    await rows.first().hover();
    const removeButton = rows.first().locator('button').last();
    await removeButton.click();

    // Row should be removed immediately (no dialog)
    await expect(rows).toHaveCount(0);
});

test('removing a row with entries shows confirmation dialog and deletes entries', async ({
    page,
    ctx,
}) => {
    const monday = getCurrentWeekMonday();
    const project = await createProjectViaApi(ctx, { name: 'Delete Row Project' });

    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '2h',
        projectId: project.id,
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(1);

    // Hover and click X
    await rows.first().hover();
    const removeButton = rows.first().locator('button').last();
    await removeButton.click();

    // Confirmation dialog should appear
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByText('Remove timesheet row?')).toBeVisible();

    // Click Delete
    await Promise.all([
        page.waitForResponse(
            (resp) =>
                resp.url().includes('/time-entries') &&
                resp.request().method() === 'DELETE' &&
                resp.status() === 200
        ),
        page.getByRole('alertdialog').getByRole('button', { name: /Delete/i }).click(),
    ]);

    // Row should be gone
    await expect(rows).toHaveCount(0);
});

// ──────────────────────────────────────────────────
// Multiple Entries Same Cell
// ──────────────────────────────────────────────────

test('cell correctly sums multiple entries for same project+day', async ({ page, ctx }) => {
    const monday = getCurrentWeekMonday();
    const project = await createProjectViaApi(ctx, { name: 'Sum Test' });

    // Create 2 entries for the same project on Monday
    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '1h',
        projectId: project.id,
        description: 'Entry 1',
    });
    await createTimeEntryOnDateViaApi(ctx, {
        date: monday,
        duration: '2h',
        projectId: project.id,
        description: 'Entry 2',
    });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Should be 1 row (both entries grouped)
    const rows = page.locator('[data-testid="timesheet_row"]');
    await expect(rows).toHaveCount(1);

    // The Monday cell should show 3h total
    const cells = rows.first().locator('[data-testid="timesheet_cell"]');
    const mondayInput = cells.first().locator('input');
    // The value should contain "3" (for 3h in some format)
    await expect(mondayInput).toHaveValue(/3/);
});

// ──────────────────────────────────────────────────
// Duration Input Formats
// ──────────────────────────────────────────────────

test('cell accepts various duration input formats', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, { name: 'Format Test' });

    await Promise.all([goToTimesheet(page), waitForTimesheetLoad(page)]);

    // Add a row and select project
    await page.getByRole('button', { name: /Add row/i }).first().click();

    const row = page.locator('[data-testid="timesheet_row"]').first();
    await row.getByText('No Project').click();
    await page.getByText('Format Test').click();

    // Test entering "1.5" (should be 1h 30min)
    const cells = row.locator('[data-testid="timesheet_cell"]');
    const mondayInput = cells.first().locator('input');

    await mondayInput.click();
    await mondayInput.fill('1.5');

    await Promise.all([
        page.waitForResponse(
            (resp) =>
                resp.url().includes('/time-entries') &&
                resp.request().method() === 'POST' &&
                resp.status() === 201
        ),
        mondayInput.press('Enter'),
    ]);

    // Cell should now show a value (format depends on org settings)
    await expect(mondayInput).not.toHaveValue('');
});
