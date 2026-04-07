import { test, expect } from '../playwright/fixtures';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { createProjectViaApi, createTagViaApi, createTimeEntryViaApi } from './utils/api';

// Increase timeout for performance tests — data setup takes time
test.setTimeout(120_000);

const NUM_PROJECTS = 10;
const NUM_TAGS = 5;
const NUM_TIME_ENTRIES = 200;
const BENCHMARK_RUNS = 3;

test('benchmark: time page load with many time entries', async ({ page, ctx }) => {
    // ── 1. Create test data ───────────────────────────
    console.log('Creating test data...');
    const dataStart = Date.now();

    // Create projects and tags in parallel
    const [projects, tags] = await Promise.all([
        Promise.all(
            Array.from({ length: NUM_PROJECTS }, (_, i) =>
                createProjectViaApi(ctx, { name: `Perf Project ${i + 1}` })
            )
        ),
        Promise.all(
            Array.from({ length: NUM_TAGS }, (_, i) =>
                createTagViaApi(ctx, { name: `perf-tag-${i + 1}` })
            )
        ),
    ]);

    // Create time entries in concurrent batches of 20
    const batchSize = 20;
    const allEntries = [];
    for (let batch = 0; batch < NUM_TIME_ENTRIES; batch += batchSize) {
        const count = Math.min(batchSize, NUM_TIME_ENTRIES - batch);
        const batchEntries = await Promise.all(
            Array.from({ length: count }, (_, i) => {
                const idx = batch + i;
                const project = projects[idx % projects.length]!;
                const tag = tags[idx % tags.length]!;
                // Spread entries across the last 30 days
                const daysAgo = Math.floor(idx / 7);
                const minuteOffset = (idx % 7) * 60 + 30; // stagger within day
                const start = new Date();
                start.setDate(start.getDate() - daysAgo);
                start.setHours(8, minuteOffset % 60, 0, 0);
                const end = new Date(start.getTime() + 45 * 60 * 1000); // 45 min entries
                return createTimeEntryViaApi(ctx, {
                    description: `Perf entry ${idx + 1}`,
                    duration: '45min',
                    projectId: project.id,
                    tags: [tag.id],
                    billable: idx % 3 === 0,
                });
            })
        );
        allEntries.push(...batchEntries);
    }

    const dataTime = Date.now() - dataStart;
    console.log(
        `Test data created in ${dataTime}ms: ${NUM_PROJECTS} projects, ${NUM_TAGS} tags, ${allEntries.length} time entries`
    );

    // ── 2. Navigate to dashboard first ────────────────
    await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');
    await page.waitForLoadState('networkidle');

    // ── 3. Benchmark: navigate from dashboard to /time ─
    const results: number[] = [];

    for (let run = 0; run < BENCHMARK_RUNS; run++) {
        // Make sure we're on dashboard
        if (run > 0) {
            await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');
            await page.waitForLoadState('networkidle');
        }

        const navStart = Date.now();

        // Navigate to time page
        await page.goto(PLAYWRIGHT_BASE_URL + '/time');

        // Wait for time entries to actually render in the DOM
        const firstRow = page.locator('[data-testid="time_entry_row"]').first();
        await firstRow.waitFor({ state: 'visible', timeout: 30_000 });

        // Also wait until at least some rows are rendered
        await expect(page.locator('[data-testid="time_entry_row"]')).not.toHaveCount(0);

        const navEnd = Date.now();
        const elapsed = navEnd - navStart;
        results.push(elapsed);

        console.log(`Run ${run + 1}/${BENCHMARK_RUNS}: ${elapsed}ms`);
    }

    // ── 4. Report results ─────────────────────────────
    const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    const min = Math.min(...results);
    const max = Math.max(...results);

    console.log('');
    console.log('=== PERFORMANCE BENCHMARK RESULTS ===');
    console.log(`Time entries: ${allEntries.length}`);
    console.log(`Projects: ${NUM_PROJECTS}, Tags: ${NUM_TAGS}`);
    console.log(`Runs: ${BENCHMARK_RUNS}`);
    console.log(`Average: ${avg}ms`);
    console.log(`Min: ${min}ms`);
    console.log(`Max: ${max}ms`);
    console.log(`Individual: ${results.map((r) => r + 'ms').join(', ')}`);
    console.log('=====================================');

    // Sanity assertion: page should load within 15 seconds
    expect(avg).toBeLessThan(15_000);
});

test('benchmark: reporting detailed page load with many time entries', async ({ page, ctx }) => {
    // ── 1. Create test data ───────────────────────────
    console.log('Creating test data...');
    const dataStart = Date.now();

    const [projects, tags] = await Promise.all([
        Promise.all(
            Array.from({ length: NUM_PROJECTS }, (_, i) =>
                createProjectViaApi(ctx, { name: `Perf Project ${i + 1}` })
            )
        ),
        Promise.all(
            Array.from({ length: NUM_TAGS }, (_, i) =>
                createTagViaApi(ctx, { name: `perf-tag-${i + 1}` })
            )
        ),
    ]);

    // Spread entries across last 14 days (reporting detailed default range)
    const batchSize = 20;
    const allEntries = [];
    for (let batch = 0; batch < NUM_TIME_ENTRIES; batch += batchSize) {
        const count = Math.min(batchSize, NUM_TIME_ENTRIES - batch);
        const batchEntries = await Promise.all(
            Array.from({ length: count }, (_, i) => {
                const idx = batch + i;
                const project = projects[idx % projects.length]!;
                const tag = tags[idx % tags.length]!;
                return createTimeEntryViaApi(ctx, {
                    description: `Perf entry ${idx + 1}`,
                    duration: '45min',
                    projectId: project.id,
                    tags: [tag.id],
                    billable: idx % 3 === 0,
                });
            })
        );
        allEntries.push(...batchEntries);
    }

    const dataTime = Date.now() - dataStart;
    console.log(
        `Test data created in ${dataTime}ms: ${NUM_PROJECTS} projects, ${NUM_TAGS} tags, ${allEntries.length} time entries`
    );

    // ── 2. Navigate to dashboard first ────────────────
    await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');
    await page.waitForLoadState('networkidle');

    // ── 3. Benchmark: navigate to /reporting/detailed ──
    const results: number[] = [];

    for (let run = 0; run < BENCHMARK_RUNS; run++) {
        if (run > 0) {
            await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');
            await page.waitForLoadState('networkidle');
        }

        const navStart = Date.now();

        await page.goto(PLAYWRIGHT_BASE_URL + '/reporting/detailed');

        const firstRow = page.locator('[data-testid="time_entry_row"]').first();
        await firstRow.waitFor({ state: 'visible', timeout: 30_000 });

        await expect(page.locator('[data-testid="time_entry_row"]')).not.toHaveCount(0);

        const navEnd = Date.now();
        const elapsed = navEnd - navStart;
        results.push(elapsed);

        console.log(`Run ${run + 1}/${BENCHMARK_RUNS}: ${elapsed}ms`);
    }

    // ── 4. Report results ─────────────────────────────
    const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    const min = Math.min(...results);
    const max = Math.max(...results);

    console.log('');
    console.log('=== REPORTING DETAILED BENCHMARK RESULTS ===');
    console.log(`Time entries: ${allEntries.length}`);
    console.log(`Projects: ${NUM_PROJECTS}, Tags: ${NUM_TAGS}`);
    console.log(`Runs: ${BENCHMARK_RUNS}`);
    console.log(`Average: ${avg}ms`);
    console.log(`Min: ${min}ms`);
    console.log(`Max: ${max}ms`);
    console.log(`Individual: ${results.map((r) => r + 'ms').join(', ')}`);
    console.log('============================================');

    expect(avg).toBeLessThan(15_000);
});
