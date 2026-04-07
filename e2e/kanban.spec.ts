import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import {
    createProjectViaApi,
    createPublicProjectViaApi,
    createTaskViaApi,
    updateTaskViaApi,
    createClientViaApi,
    archiveProjectViaApi,
} from './utils/api';

async function goToKanban(page: Page) {
    await page.goto(PLAYWRIGHT_BASE_URL + '/kanban');
}

// =============================================
// Navigation & Page Loading
// =============================================

test('test that kanban board page loads and shows columns', async ({ page }) => {
    await goToKanban(page);
    await expect(page.getByTestId('kanban_view')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
    await expect(page.getByText('Done')).toBeVisible();
});

test('test that kanban board is accessible from sidebar navigation', async ({ page }) => {
    await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');
    await page.getByRole('link', { name: 'Board' }).click();
    await page.waitForURL('**/kanban');
    await expect(page.getByTestId('kanban_view')).toBeVisible();
});

// =============================================
// Task Display
// =============================================

test('test that active tasks appear in the Active column', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, {
        name: 'KanbanActive ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'ActiveTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    const activeColumn = page.getByTestId('kanban-column-active');
    await expect(activeColumn).toContainText(task.name);
});

test('test that done tasks appear in the Done column', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, {
        name: 'KanbanDone ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'DoneTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });
    await updateTaskViaApi(ctx, task.id, { name: task.name, is_done: true });

    await goToKanban(page);
    const doneColumn = page.getByTestId('kanban-column-done');
    await expect(doneColumn).toContainText(task.name);
});

test('test that task cards show the project name', async ({ page, ctx }) => {
    const projectName = 'ProjBadge ' + Math.floor(Math.random() * 10000);
    const project = await createProjectViaApi(ctx, { name: projectName });
    await createTaskViaApi(ctx, {
        name: 'BadgeTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    const activeColumn = page.getByTestId('kanban-column-active');
    await expect(activeColumn).toContainText(projectName);
});

test('test that multiple tasks from different projects display correctly', async ({
    page,
    ctx,
}) => {
    const project1 = await createProjectViaApi(ctx, {
        name: 'MultiProj1 ' + Math.floor(Math.random() * 10000),
    });
    const project2 = await createProjectViaApi(ctx, {
        name: 'MultiProj2 ' + Math.floor(Math.random() * 10000),
    });
    const task1 = await createTaskViaApi(ctx, {
        name: 'MultiTask1 ' + Math.floor(Math.random() * 10000),
        project_id: project1.id,
    });
    const task2 = await createTaskViaApi(ctx, {
        name: 'MultiTask2 ' + Math.floor(Math.random() * 10000),
        project_id: project2.id,
    });

    await goToKanban(page);
    await expect(page.getByText(task1.name)).toBeVisible();
    await expect(page.getByText(task2.name)).toBeVisible();
});

test('test that column task counts are displayed', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, {
        name: 'CountProj ' + Math.floor(Math.random() * 10000),
    });
    await createTaskViaApi(ctx, {
        name: 'CountTask1 ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });
    await createTaskViaApi(ctx, {
        name: 'CountTask2 ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    const activeColumn = page.getByTestId('kanban-column-active');
    const heading = activeColumn.locator('h3');
    await expect(heading).toBeVisible();
});

// =============================================
// Task Card Interactions
// =============================================

test('test that clicking a task card opens the edit modal', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, {
        name: 'EditModalProj ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'EditModalTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    await page.getByText(task.name).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Update Task');
});

test('test that editing a task name from kanban card works', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, {
        name: 'EditProj ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'OriginalKanban ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });
    const updatedName = 'UpdatedKanban ' + Math.floor(Math.random() * 10000);

    await goToKanban(page);
    await page.getByText(task.name).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByPlaceholder('Task Name').fill(updatedName);
    await Promise.all([
        page.getByRole('button', { name: 'Update Task' }).click(),
        page.waitForResponse(
            (response) =>
                response.url().includes('/tasks') &&
                response.request().method() === 'PUT' &&
                response.status() === 200
        ),
    ]);

    await expect(page.getByText(updatedName)).toBeVisible();
    await expect(page.getByText(task.name)).not.toBeVisible();
});

test('test that task more-options dropdown works on kanban card', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, {
        name: 'DropdownProj ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'DropdownTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    const actionsButton = page.locator(`[aria-label='Actions for Task ${task.name}']`);
    await actionsButton.click();
    await expect(page.getByRole('menuitem').getByText('Edit')).toBeVisible();
    await expect(page.getByRole('menuitem').getByText('Mark as done')).toBeVisible();
});

test('test that marking task as done via dropdown moves it to Done column', async ({
    page,
    ctx,
}) => {
    const project = await createProjectViaApi(ctx, {
        name: 'MarkDoneProj ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'MarkDoneTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    const activeColumn = page.getByTestId('kanban-column-active');
    await expect(activeColumn).toContainText(task.name);

    const actionsButton = page.locator(`[aria-label='Actions for Task ${task.name}']`);
    await actionsButton.click();
    await Promise.all([
        page.getByRole('menuitem').getByText('Mark as done').first().click(),
        page.waitForResponse(
            (response) =>
                response.url().includes('/tasks') &&
                response.request().method() === 'PUT' &&
                response.status() === 200
        ),
    ]);

    const doneColumn = page.getByTestId('kanban-column-done');
    await expect(doneColumn).toContainText(task.name);
});

test('test that deleting a task via dropdown removes it from kanban', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, {
        name: 'DeleteProj ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'DeleteTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    await expect(page.getByText(task.name)).toBeVisible();

    const actionsButton = page.locator(`[aria-label='Actions for Task ${task.name}']`);
    await actionsButton.click();
    const deleteButton = page.locator(`[aria-label='Delete Task ${task.name}']`);
    await Promise.all([
        deleteButton.click(),
        page.waitForResponse(
            (response) =>
                response.url().includes('/tasks') &&
                response.request().method() === 'DELETE' &&
                response.status() === 204
        ),
    ]);

    await expect(page.getByText(task.name)).not.toBeVisible();
});

// =============================================
// Add Task Button
// =============================================

test('test that add task button opens the create task modal', async ({ page, ctx }) => {
    await createProjectViaApi(ctx, {
        name: 'AddTaskProj ' + Math.floor(Math.random() * 10000),
    });

    await goToKanban(page);
    await page.getByRole('button', { name: 'Add task' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Create Task');
});

test('test that creating a task from kanban add button shows it on the board', async ({
    page,
    ctx,
}) => {
    await createProjectViaApi(ctx, {
        name: 'NewTaskProj ' + Math.floor(Math.random() * 10000),
    });
    const newTaskName = 'NewKanbanTask ' + Math.floor(Math.random() * 10000);

    await goToKanban(page);
    await page.getByRole('button', { name: 'Add task' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByPlaceholder('Task Name').fill(newTaskName);
    await Promise.all([
        page.getByRole('dialog').getByRole('button', { name: 'Create Task' }).click(),
        page.waitForResponse(
            async (response) =>
                response.url().includes('/tasks') &&
                response.request().method() === 'POST' &&
                response.status() === 201 &&
                (await response.json()).data.name === newTaskName
        ),
    ]);

    await expect(page.getByText(newTaskName)).toBeVisible();
});

// =============================================
// Filters
// =============================================

test('test that project status filter hides tasks from archived projects', async ({
    page,
    ctx,
}) => {
    const activeProject = await createProjectViaApi(ctx, {
        name: 'FilterActive ' + Math.floor(Math.random() * 10000),
    });
    const archivedProject = await createProjectViaApi(ctx, {
        name: 'FilterArchived ' + Math.floor(Math.random() * 10000),
    });
    await archiveProjectViaApi(ctx, archivedProject.id);
    const activeTask = await createTaskViaApi(ctx, {
        name: 'ActiveProjTask ' + Math.floor(Math.random() * 10000),
        project_id: activeProject.id,
    });
    const archivedTask = await createTaskViaApi(ctx, {
        name: 'ArchivedProjTask ' + Math.floor(Math.random() * 10000),
        project_id: archivedProject.id,
    });

    await goToKanban(page);

    // Both should be visible initially (no filter)
    await expect(page.getByText(activeTask.name)).toBeVisible();
    await expect(page.getByText(archivedTask.name)).toBeVisible();

    // Apply "Active" status filter
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByText('Status').click();
    await page.getByRole('menuitem', { name: 'Active' }).click();

    // Only active project task should be visible
    await expect(page.getByText(activeTask.name)).toBeVisible();
    await expect(page.getByText(archivedTask.name)).not.toBeVisible();
});

test('test that client filter shows only tasks from projects of selected client', async ({
    page,
    ctx,
}) => {
    const client = await createClientViaApi(ctx, {
        name: 'FilterClient ' + Math.floor(Math.random() * 10000),
    });
    const clientProject = await createProjectViaApi(ctx, {
        name: 'ClientProj ' + Math.floor(Math.random() * 10000),
        client_id: client.id,
    });
    const noClientProject = await createProjectViaApi(ctx, {
        name: 'NoClientProj ' + Math.floor(Math.random() * 10000),
    });
    const clientTask = await createTaskViaApi(ctx, {
        name: 'ClientTask ' + Math.floor(Math.random() * 10000),
        project_id: clientProject.id,
    });
    const noClientTask = await createTaskViaApi(ctx, {
        name: 'NoClientTask ' + Math.floor(Math.random() * 10000),
        project_id: noClientProject.id,
    });

    await goToKanban(page);
    await expect(page.getByText(clientTask.name)).toBeVisible();
    await expect(page.getByText(noClientTask.name)).toBeVisible();

    // Apply client filter
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByText('Client').click();
    await page.getByRole('menuitemcheckbox', { name: client.name }).click();
    // Close dropdown by pressing Escape
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expect(page.getByText(clientTask.name)).toBeVisible();
    await expect(page.getByText(noClientTask.name)).not.toBeVisible();
});

test('test that filter badges appear and can be removed', async ({ page, ctx }) => {
    const project = await createProjectViaApi(ctx, {
        name: 'BadgeTestProj ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'BadgeTestTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    await expect(page.getByText(task.name)).toBeVisible();

    // Apply status filter
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByText('Status').click();
    await page.getByRole('menuitem', { name: 'Active' }).click();

    // Status badge should appear (the badge text shows "Status is Active")
    const badge = page
        .locator('div')
        .filter({ hasText: /Status.*is.*Active/ })
        .first();
    await expect(badge).toBeVisible();

    // Remove the filter by clicking the X button on the badge
    await badge.locator('button').last().click();

    // Task should remain visible (filter removed, showing all again)
    await expect(page.getByText(task.name)).toBeVisible();
});

// =============================================
// Drag and Drop
// =============================================

test('test that dragging a task from Active to Done updates the task status', async ({
    page,
    ctx,
}) => {
    const project = await createProjectViaApi(ctx, {
        name: 'DragProj ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'DragTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });

    await goToKanban(page);
    const activeColumn = page.getByTestId('kanban-column-active');
    const doneColumn = page.getByTestId('kanban-column-done');
    await expect(activeColumn).toContainText(task.name);

    // Drag the task card to the Done column
    const taskCard = page.getByText(task.name);
    await Promise.all([
        taskCard.dragTo(doneColumn),
        page.waitForResponse(
            (response) =>
                response.url().includes('/tasks') &&
                response.request().method() === 'PUT' &&
                response.status() === 200
        ),
    ]);

    await expect(doneColumn).toContainText(task.name);
});

test('test that dragging a task from Done to Active updates the task status', async ({
    page,
    ctx,
}) => {
    const project = await createProjectViaApi(ctx, {
        name: 'DragBackProj ' + Math.floor(Math.random() * 10000),
    });
    const task = await createTaskViaApi(ctx, {
        name: 'DragBackTask ' + Math.floor(Math.random() * 10000),
        project_id: project.id,
    });
    await updateTaskViaApi(ctx, task.id, { name: task.name, is_done: true });

    await goToKanban(page);
    const activeColumn = page.getByTestId('kanban-column-active');
    const doneColumn = page.getByTestId('kanban-column-done');
    await expect(doneColumn).toContainText(task.name);

    const taskCard = page.getByText(task.name);
    await Promise.all([
        taskCard.dragTo(activeColumn),
        page.waitForResponse(
            (response) =>
                response.url().includes('/tasks') &&
                response.request().method() === 'PUT' &&
                response.status() === 200
        ),
    ]);

    await expect(activeColumn).toContainText(task.name);
});

// =============================================
// Empty States
// =============================================

test('test that kanban board works with no tasks', async ({ page }) => {
    await goToKanban(page);
    await expect(page.getByTestId('kanban_view')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
    await expect(page.getByText('Done')).toBeVisible();
});

// =============================================
// Employee Permissions
// =============================================

test.describe('Employee Kanban Board', () => {
    test('employee can view the kanban board with public project tasks', async ({
        ctx,
        employee,
    }) => {
        const project = await createPublicProjectViaApi(ctx, {
            name: 'EmpKanbanProj ' + Math.floor(Math.random() * 10000),
        });
        const task = await createTaskViaApi(ctx, {
            name: 'EmpKanbanTask ' + Math.floor(Math.random() * 10000),
            project_id: project.id,
        });

        await employee.page.goto(PLAYWRIGHT_BASE_URL + '/kanban');
        await expect(employee.page.getByTestId('kanban_view')).toBeVisible();
        await expect(employee.page.getByText(task.name)).toBeVisible();
    });

    test('employee cannot see add task button when employees_can_manage_tasks is disabled', async ({
        ctx,
        employee,
    }) => {
        await createPublicProjectViaApi(ctx, {
            name: 'EmpNoManageProj ' + Math.floor(Math.random() * 10000),
        });

        await employee.page.goto(PLAYWRIGHT_BASE_URL + '/kanban');
        await expect(employee.page.getByRole('button', { name: 'Add task' })).not.toBeVisible();
    });
});
