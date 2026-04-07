import { test, expect } from '../playwright/fixtures';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';

/**
 * Helper to switch to a non-current org via the switcher dropdown.
 * Returns the name of the org that was switched to.
 */
async function switchToOtherOrg(page: import('@playwright/test').Page, currentOrgName: string) {
    const orgSwitcher = page.locator('[data-testid="organization_switcher"]:visible');
    await orgSwitcher.click();
    await expect(page.getByText('Switch Organizations')).toBeVisible();

    // With as-child, the button itself becomes the menuitem
    const submitButtons = page.locator('form button[type="submit"]');
    const count = await submitButtons.count();
    let targetOrgName = '';
    for (let i = 0; i < count; i++) {
        const text = await submitButtons.nth(i).innerText();
        if (!text.includes(currentOrgName)) {
            targetOrgName = text.trim();
            await submitButtons.nth(i).click();
            break;
        }
    }

    expect(targetOrgName).not.toBe('');
    await expect(orgSwitcher).toContainText(targetOrgName, { timeout: 10000 });
    return targetOrgName;
}

test.describe('Organization Switching', () => {
    test('switching organization persists after clicking a navigation item', async ({ page }) => {
        const newOrgName = 'SwitchTestOrg' + Math.floor(Math.random() * 10000);

        // Start on dashboard
        await expect(page.getByTestId('dashboard_view')).toBeVisible({ timeout: 10000 });
        const orgSwitcher = page.locator('[data-testid="organization_switcher"]:visible');

        // Create a second organization (this navigates us to the new org)
        await page.goto(PLAYWRIGHT_BASE_URL + '/teams/create');
        await page.getByLabel('Organization Name').fill(newOrgName);
        await page.getByRole('button', { name: 'Create' }).click();
        await expect(page.getByTestId('dashboard_view')).toBeVisible({ timeout: 10000 });
        await expect(orgSwitcher).toContainText(newOrgName);

        // Hover over navigation items to trigger Inertia prefetch cache
        // This is key to reproducing the bug — prefetching caches the page
        // response with the CURRENT org context
        const timeLink = page.getByRole('link', { name: 'Time' });
        const projectsLink = page.getByRole('link', { name: 'Projects' });
        await timeLink.hover();
        await page.waitForTimeout(500); // Allow prefetch to fire
        await projectsLink.hover();
        await page.waitForTimeout(500);

        // Now switch to the other (original) org
        const originalOrgName = await switchToOtherOrg(page, newOrgName);

        // Click on "Time" — the prefetch cache may serve the old org's page
        await page.getByRole('link', { name: 'Time' }).click();
        await expect(page.getByTestId('time_view')).toBeVisible({ timeout: 10000 });

        // After navigating, the organization should still be the switched-to org
        await expect(orgSwitcher).toContainText(originalOrgName, { timeout: 5000 });
    });

    test('switching organization persists when navigating to Projects after hover', async ({
        page,
    }) => {
        const newOrgName = 'ProjSwitchOrg' + Math.floor(Math.random() * 10000);

        // Start on dashboard
        await expect(page.getByTestId('dashboard_view')).toBeVisible({ timeout: 10000 });
        const orgSwitcher = page.locator('[data-testid="organization_switcher"]:visible');

        // Create a second organization
        await page.goto(PLAYWRIGHT_BASE_URL + '/teams/create');
        await page.getByLabel('Organization Name').fill(newOrgName);
        await page.getByRole('button', { name: 'Create' }).click();
        await expect(page.getByTestId('dashboard_view')).toBeVisible({ timeout: 10000 });

        // Hover over Projects link to trigger prefetch
        const projectsLink = page.getByRole('link', { name: 'Projects' });
        await projectsLink.hover();
        await page.waitForTimeout(500);

        // Switch to the other org
        const originalOrgName = await switchToOtherOrg(page, newOrgName);

        // Navigate to Projects — prefetch cache might serve stale data
        await page.getByRole('link', { name: 'Projects' }).click();
        await page.waitForURL('**/projects');

        // Organization should still be the one we switched to
        await expect(orgSwitcher).toContainText(originalOrgName, { timeout: 5000 });
    });

    test('rapid org switch then navigate does not revert organization', async ({ page }) => {
        const newOrgName = 'RapidSwitchOrg' + Math.floor(Math.random() * 10000);

        // Start on dashboard
        await expect(page.getByTestId('dashboard_view')).toBeVisible({ timeout: 10000 });
        const orgSwitcher = page.locator('[data-testid="organization_switcher"]:visible');

        // Create a second organization
        await page.goto(PLAYWRIGHT_BASE_URL + '/teams/create');
        await page.getByLabel('Organization Name').fill(newOrgName);
        await page.getByRole('button', { name: 'Create' }).click();
        await expect(page.getByTestId('dashboard_view')).toBeVisible({ timeout: 10000 });

        // Navigate to Time page first (in new org context)
        await page.getByRole('link', { name: 'Time' }).click();
        await expect(page.getByTestId('time_view')).toBeVisible({ timeout: 10000 });

        // Switch org
        const originalOrgName = await switchToOtherOrg(page, newOrgName);

        // Immediately click another nav item
        await page.getByRole('link', { name: 'Dashboard' }).click();
        await expect(page.getByTestId('dashboard_view')).toBeVisible({ timeout: 10000 });

        // Should still be the org we switched to
        await expect(orgSwitcher).toContainText(originalOrgName, { timeout: 5000 });

        // Navigate again to yet another page
        await page.getByRole('link', { name: 'Time' }).click();
        await expect(page.getByTestId('time_view')).toBeVisible({ timeout: 10000 });

        // Should still be the same org
        await expect(orgSwitcher).toContainText(originalOrgName, { timeout: 5000 });
    });
});
