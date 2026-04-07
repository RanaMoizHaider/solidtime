<script setup lang="ts">
import AppLayout from '@/Layouts/AppLayout.vue';
import MainContainer from '@/packages/ui/src/MainContainer.vue';
import LoadingSpinner from '@/packages/ui/src/LoadingSpinner.vue';
import { Button } from '@/packages/ui/src/Buttons';
import TimesheetRow from '@/Components/Timesheet/TimesheetRow.vue';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/Components/ui/alert-dialog';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronDownIcon,
    CalendarIcon,
    PlusIcon,
    DocumentDuplicateIcon,
    ClockIcon,
    TableCellsIcon,
    ListBulletIcon,
} from '@heroicons/vue/20/solid';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/Components/ui/dropdown-menu';
import { computed, inject, ref, watch, type ComputedRef } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import { getDayJsInstance, formatHumanReadableDuration, getLocalizedDateFromTimestamp, localDateToUtc } from '@/packages/ui/src/utils/time';
import { getUserTimezone, getWeekStart } from '@/packages/ui/src/utils/settings';
import { useTimesheetQuery, prefetchTimesheetWeek, fetchTimesheetEntries } from '@/utils/useTimesheetQuery';
import { useTimesheetGrid, makeRowKey, type TimesheetRowKey } from '@/utils/useTimesheetGrid';
import { useTimeEntriesMutations } from '@/utils/useTimeEntriesMutations';
import { useProjectsQuery } from '@/utils/useProjectsQuery';
import { useTasksQuery } from '@/utils/useTasksQuery';
import { useClientsQuery } from '@/utils/useClientsQuery';
import { useProjectsStore } from '@/utils/useProjects';
import { useClientsStore } from '@/utils/useClients';
import { getOrganizationCurrencyString } from '@/utils/money';
import { isAllowedToPerformPremiumAction } from '@/utils/billing';
import { canCreateProjects } from '@/utils/permissions';
import { getCurrentMembershipId, getCurrentOrganizationId } from '@/utils/useUser';
import type {
    CreateProjectBody,
    CreateClientBody,
    Project,
    Client,
    Organization,
    TimeEntry,
} from '@/packages/api/src';

const organization = inject<ComputedRef<Organization>>('organization');
const queryClient = useQueryClient();

// ──────────────────────────────────────────────────
// Week navigation
// ──────────────────────────────────────────────────

const dayjs = getDayJsInstance();

function getWeekStartDate(): Date {
    const weekStart = getWeekStart();
    const weekStartMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6,
    };
    const firstDay = weekStartMap[weekStart] ?? 1;
    const now = dayjs();
    const currentDayOfWeek = now.day();
    const daysFromWeekStart = (currentDayOfWeek - firstDay + 7) % 7;
    return now.subtract(daysFromWeekStart, 'day').startOf('day').toDate();
}

const currentWeekStart = ref<Date>(getWeekStartDate());

const weekStart = computed(() => currentWeekStart.value);
const weekEnd = computed(() => dayjs(currentWeekStart.value).add(7, 'day').toDate());

const weekDays = computed(() => {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
        days.push(dayjs(currentWeekStart.value).add(i, 'day').format('YYYY-MM-DD'));
    }
    return days;
});

const weekNumber = computed(() => dayjs(currentWeekStart.value).week());

const isCurrentWeek = computed(() => {
    const current = getWeekStartDate();
    return dayjs(currentWeekStart.value).isSame(dayjs(current), 'day');
});

const todayDate = computed(() => {
    const tz = getUserTimezone();
    return dayjs().tz(tz).format('YYYY-MM-DD');
});

function goToPreviousWeek() {
    currentWeekStart.value = dayjs(currentWeekStart.value).subtract(7, 'day').toDate();
    clearEmptyRows();
}

function goToNextWeek() {
    currentWeekStart.value = dayjs(currentWeekStart.value).add(7, 'day').toDate();
    clearEmptyRows();
}

function goToCurrentWeek() {
    currentWeekStart.value = getWeekStartDate();
    clearEmptyRows();
}

// Prefetch adjacent weeks
watch(currentWeekStart, () => {
    const prevStart = dayjs(currentWeekStart.value).subtract(7, 'day').toDate();
    const prevEnd = dayjs(currentWeekStart.value).toDate();
    const nextStart = dayjs(currentWeekStart.value).add(7, 'day').toDate();
    const nextEnd = dayjs(currentWeekStart.value).add(14, 'day').toDate();
    prefetchTimesheetWeek(queryClient, prevStart, prevEnd);
    prefetchTimesheetWeek(queryClient, nextStart, nextEnd);
}, { immediate: true });

// ──────────────────────────────────────────────────
// Data fetching
// ──────────────────────────────────────────────────

const { data, isPending } = useTimesheetQuery(weekStart, weekEnd);
const timeEntries = computed(() => data.value?.data ?? []);

const { projects } = useProjectsQuery();
const { tasks } = useTasksQuery();
const { clients } = useClientsQuery();

const {
    createTimeEntry: createTimeEntryMutation,
    updateTimeEntry: updateTimeEntryMutation,
    deleteTimeEntry: deleteTimeEntryMutation,
    deleteTimeEntries: deleteTimeEntriesMutation,
} = useTimeEntriesMutations();

// ──────────────────────────────────────────────────
// Grid computation
// ──────────────────────────────────────────────────

const {
    rows,
    dayTotals,
    grandTotal,
    addEmptyRow,
    removeEmptyRow,
    clearEmptyRows,
} = useTimesheetGrid(timeEntries, weekDays, projects);

// ──────────────────────────────────────────────────
// Formatting
// ──────────────────────────────────────────────────

function formatDuration(seconds: number): string {
    if (seconds === 0) return '-';
    return formatHumanReadableDuration(
        seconds,
        organization?.value?.interval_format ?? 'hours-minutes',
        organization?.value?.number_format ?? 'point'
    );
}

function formatDayHeader(date: string) {
    return {
        dayName: dayjs(date).format('ddd').toUpperCase(),
        dayDate: dayjs(date).format('MMM D'),
    };
}

// ──────────────────────────────────────────────────
// Cell mutation logic
// ──────────────────────────────────────────────────

function getLatestEndOnDay(date: string): string | null {
    let latest: string | null = null;
    for (const entry of timeEntries.value) {
        if (!entry.end) continue;
        const entryDate = getLocalizedDateFromTimestamp(entry.start);
        if (entryDate !== date) continue;
        if (!latest || entry.end > latest) {
            latest = entry.end;
        }
    }
    return latest;
}

async function handleCellUpdate(
    row: typeof rows.value[0],
    dayIndex: number,
    newTotalSeconds: number
) {
    const date = weekDays.value[dayIndex]!;
    const cell = row.cells.get(dayIndex);
    const existingSeconds = cell?.totalSeconds ?? 0;
    const diff = newTotalSeconds - existingSeconds;

    if (diff === 0) return;

    const tz = getUserTimezone();

    if (newTotalSeconds === 0 && cell) {
        // Delete all entries in this cell
        await deleteTimeEntriesMutation(cell.entries);
        return;
    }

    if (!cell || existingSeconds === 0) {
        // Empty cell: create new entry
        const latestEnd = getLatestEndOnDay(date);
        let startTime: string;
        if (latestEnd) {
            startTime = latestEnd;
        } else {
            startTime = dayjs.tz(`${date} 09:00:00`, tz).utc().format();
        }
        const endTime = dayjs.utc(startTime).add(newTotalSeconds, 'second').format();

        const project = row.projectId
            ? projects.value.find((p) => p.id === row.projectId)
            : null;

        await createTimeEntryMutation({
            project_id: row.projectId,
            task_id: row.taskId,
            start: startTime,
            end: endTime,
            billable: project?.is_billable ?? false,
            description: null,
            tags: [],
        });
        return;
    }

    if (diff > 0) {
        // Increase: extend the last entry
        const sortedEntries = [...cell.entries].sort(
            (a, b) => a.start.localeCompare(b.start)
        );
        const lastEntry = sortedEntries[sortedEntries.length - 1]!;
        if (!lastEntry.end) return; // running entry, skip

        const newEnd = dayjs.utc(lastEntry.end).add(diff, 'second').format();
        await updateTimeEntryMutation({ ...lastEntry, end: newEnd });
        return;
    }

    // Decrease: shorten from the last entry backwards
    let toRemove = Math.abs(diff);
    const sortedEntries = [...cell.entries].sort(
        (a, b) => b.start.localeCompare(a.start) // most recent first
    );

    for (const entry of sortedEntries) {
        if (toRemove <= 0) break;
        if (!entry.end) continue; // skip running entries

        const entryDuration = entry.duration ?? 0;

        if (entryDuration <= toRemove) {
            // Delete this entry entirely
            await deleteTimeEntryMutation(entry.id);
            toRemove -= entryDuration;
        } else {
            // Shorten this entry
            const newEnd = dayjs.utc(entry.start).add(entryDuration - toRemove, 'second').format();
            await updateTimeEntryMutation({ ...entry, end: newEnd });
            toRemove = 0;
        }
    }
}

// ──────────────────────────────────────────────────
// Row management
// ──────────────────────────────────────────────────

const showDeleteDialog = ref(false);
const rowToDelete = ref<typeof rows.value[0] | null>(null);

function handleRemoveRow(key: TimesheetRowKey) {
    const row = rows.value.find((r) => r.key === key);
    if (!row) return;

    if (row.totalSeconds === 0) {
        // Empty row, remove immediately
        removeEmptyRow(key);
        return;
    }

    // Row has entries, show confirmation
    rowToDelete.value = row;
    showDeleteDialog.value = true;
}

async function confirmDeleteRow() {
    if (!rowToDelete.value) return;

    const allEntries: TimeEntry[] = [];
    for (const cell of rowToDelete.value.cells.values()) {
        allEntries.push(...cell.entries);
    }

    if (allEntries.length > 0) {
        await deleteTimeEntriesMutation(allEntries);
    }
    removeEmptyRow(rowToDelete.value.key);
    showDeleteDialog.value = false;
    rowToDelete.value = null;
}

function getDeleteRowProjectName(): string {
    if (!rowToDelete.value?.projectId) return 'No Project';
    return projects.value.find((p) => p.id === rowToDelete.value?.projectId)?.name ?? 'Unknown';
}

function getDeleteRowEntryCount(): number {
    if (!rowToDelete.value) return 0;
    let count = 0;
    for (const cell of rowToDelete.value.cells.values()) {
        count += cell.entries.length;
    }
    return count;
}

// ──────────────────────────────────────────────────
// Project/task change on existing row
// ──────────────────────────────────────────────────

async function handleProjectTaskChange(
    row: typeof rows.value[0],
    projectId: string | null,
    taskId: string | null
) {
    // Collect all entry IDs from this row
    const entryIds: string[] = [];
    for (const cell of row.cells.values()) {
        for (const entry of cell.entries) {
            entryIds.push(entry.id);
        }
    }

    if (entryIds.length > 0) {
        const { updateTimeEntries } = useTimeEntriesMutations();
        await updateTimeEntries({
            ids: entryIds,
            changes: { project_id: projectId, task_id: taskId },
        });
    }

    // Update empty row entry if it exists
    removeEmptyRow(row.key);
    addEmptyRow(projectId, taskId);
}

// ──────────────────────────────────────────────────
// Add row
// ──────────────────────────────────────────────────

function handleAddRow() {
    addEmptyRow(null, null);
}

// ──────────────────────────────────────────────────
// Copy last week
// ──────────────────────────────────────────────────

const isCopyingLastWeek = ref(false);

async function fetchLastWeekEntries() {
    const prevStart = dayjs(currentWeekStart.value).subtract(7, 'day').toDate();
    const prevEnd = dayjs(currentWeekStart.value).toDate();

    const orgId = getCurrentOrganizationId();
    const memberId = getCurrentMembershipId();
    if (!orgId) return null;

    return await fetchTimesheetEntries(orgId, memberId, localDateToUtc(prevStart), localDateToUtc(prevEnd));
}

async function copyLastWeekRows() {
    isCopyingLastWeek.value = true;
    try {
        const prevEntries = await fetchLastWeekEntries();
        if (!prevEntries) return;

        const existingKeys = new Set(rows.value.map((r) => r.key));
        const addedKeys = new Set<string>();

        for (const entry of prevEntries.data) {
            const key = makeRowKey(entry.project_id, entry.task_id);
            if (!existingKeys.has(key) && !addedKeys.has(key)) {
                addedKeys.add(key);
                addEmptyRow(entry.project_id, entry.task_id);
            }
        }
    } finally {
        isCopyingLastWeek.value = false;
    }
}

async function copyLastWeekWithTime() {
    isCopyingLastWeek.value = true;
    try {
        const prevEntries = await fetchLastWeekEntries();
        if (!prevEntries) return;

        const tz = getUserTimezone();

        // First, add any missing rows
        const existingKeys = new Set(rows.value.map((r) => r.key));
        const addedKeys = new Set<string>();

        for (const entry of prevEntries.data) {
            const key = makeRowKey(entry.project_id, entry.task_id);
            if (!existingKeys.has(key) && !addedKeys.has(key)) {
                addedKeys.add(key);
                addEmptyRow(entry.project_id, entry.task_id);
            }
        }

        // Then, create time entries for the current week
        for (const entry of prevEntries.data) {
            if (!entry.end || !entry.duration) continue;

            // Calculate which day-of-week this entry was on
            const entryDate = getLocalizedDateFromTimestamp(entry.start);
            const entryDayjs = dayjs(entryDate);
            const prevWeekStart = dayjs(currentWeekStart.value).subtract(7, 'day');
            const dayOffset = entryDayjs.diff(prevWeekStart, 'day');

            if (dayOffset < 0 || dayOffset >= 7) continue;

            // Map to the same day in the current week
            const newDate = weekDays.value[dayOffset];
            if (!newDate) continue;

            // Find the latest end on that day to avoid overlaps
            const latestEnd = getLatestEndOnDay(newDate);
            let startTime: string;
            if (latestEnd) {
                startTime = latestEnd;
            } else {
                startTime = dayjs.tz(`${newDate} 09:00:00`, tz).utc().format();
            }
            const endTime = dayjs.utc(startTime).add(entry.duration, 'second').format();

            const project = entry.project_id
                ? projects.value.find((p) => p.id === entry.project_id)
                : null;

            await createTimeEntryMutation({
                project_id: entry.project_id,
                task_id: entry.task_id,
                start: startTime,
                end: endTime,
                billable: project?.is_billable ?? false,
                description: entry.description ?? null,
                tags: entry.tags ?? [],
            });
        }
    } finally {
        isCopyingLastWeek.value = false;
    }
}

// ──────────────────────────────────────────────────
// Inline creation helpers
// ──────────────────────────────────────────────────

async function createProject(project: CreateProjectBody): Promise<Project | undefined> {
    return await useProjectsStore().createProject(project);
}

async function createClient(body: CreateClientBody): Promise<Client | undefined> {
    return await useClientsStore().createClient(body);
}

// ──────────────────────────────────────────────────
// Running entry tracking
// ──────────────────────────────────────────────────

const runningEntryDates = computed(() => {
    const dates = new Set<string>();
    for (const entry of timeEntries.value) {
        if (entry.end === null) {
            dates.add(getLocalizedDateFromTimestamp(entry.start));
        }
    }
    return dates;
});

// Week total formatted
const weekTotalFormatted = computed(() => {
    return formatHumanReadableDuration(
        grandTotal.value,
        organization?.value?.interval_format ?? 'hours-minutes',
        organization?.value?.number_format ?? 'point'
    );
});

// Week date range display
const weekRangeDisplay = computed(() => {
    const start = dayjs(currentWeekStart.value);
    const end = start.add(6, 'day');
    if (start.month() === end.month()) {
        return `${start.format('MMM D')} - ${end.format('D')}`;
    }
    return `${start.format('MMM D')} - ${end.format('MMM D')}`;
});
</script>

<template>
    <AppLayout title="Timesheet" data-testid="timesheet_view">
        <MainContainer class="pt-5 lg:pt-8 pb-4 lg:pb-6">
            <!-- Header -->
            <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
                <!-- Left: Week navigation -->
                <div class="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        class="h-8 w-8"
                        data-testid="timesheet_prev_week"
                        @click="goToPreviousWeek">
                        <ChevronLeftIcon class="h-4 w-4" />
                    </Button>
                    <button
                        data-testid="timesheet_week_display"
                        class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-card-background rounded-md transition"
                        @click="goToCurrentWeek">
                        <CalendarIcon class="h-4 w-4 text-icon-default" />
                        <span v-if="isCurrentWeek">This week</span>
                        <span v-else>{{ weekRangeDisplay }}</span>
                        <span class="text-text-tertiary">&middot; W{{ weekNumber }}</span>
                    </button>
                    <Button
                        variant="outline"
                        size="icon"
                        class="h-8 w-8"
                        data-testid="timesheet_next_week"
                        @click="goToNextWeek">
                        <ChevronRightIcon class="h-4 w-4" />
                    </Button>
                </div>

                <!-- Right: Actions + total -->
                <div class="flex items-center gap-3">
                    <span class="text-xs text-text-tertiary uppercase tracking-wider">Week Total</span>
                    <span
                        data-testid="timesheet_grand_total"
                        class="text-lg font-semibold text-text-primary">
                        {{ weekTotalFormatted }}
                    </span>
                </div>
            </div>

            <!-- Grid -->
            <div
                v-if="!isPending"
                class="rounded-lg bg-card-background border border-card-border overflow-x-auto">
                <div
                    class="grid min-w-[800px]"
                    style="grid-template-columns: minmax(250px, 1fr) repeat(7, minmax(90px, 1fr)) minmax(80px, 1fr)">
                    <!-- Header row -->
                    <div
                        class="px-3 py-2.5 text-xs font-medium text-text-tertiary uppercase tracking-wider sticky left-0 bg-card-background z-10">
                        Project
                    </div>
                    <div
                        v-for="day in weekDays"
                        :key="day"
                        :class="[
                            'px-2 py-2.5 text-center border-l border-default-background-separator',
                            day === todayDate ? 'bg-card-background/50' : '',
                        ]">
                        <div class="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                            {{ formatDayHeader(day).dayName }}
                        </div>
                        <div
                            :class="[
                                'text-xs mt-0.5',
                                day === todayDate ? 'text-text-primary font-semibold' : 'text-text-quaternary',
                            ]">
                            {{ formatDayHeader(day).dayDate }}
                        </div>
                    </div>
                    <div
                        class="px-3 py-2.5 text-xs font-medium text-text-tertiary uppercase tracking-wider text-right border-l border-default-background-separator">
                        Total
                    </div>

                    <!-- Data rows -->
                    <TimesheetRow
                        v-for="row in rows"
                        :key="row.key"
                        :row="row"
                        :week-days="weekDays"
                        :today-date="todayDate"
                        :projects="projects"
                        :tasks="tasks"
                        :clients="clients"
                        :currency="getOrganizationCurrencyString()"
                        :can-create-project="canCreateProjects()"
                        :enable-estimated-time="isAllowedToPerformPremiumAction()"
                        :create-project="createProject"
                        :create-client="createClient"
                        :running-entry-dates="runningEntryDates"
                        @remove-row="handleRemoveRow"
                        @cell-update="(dayIndex, seconds) => handleCellUpdate(row, dayIndex, seconds)"
                        @project-task-change="(pId, tId) => handleProjectTaskChange(row, pId, tId)" />

                    <!-- Add row -->
                    <div
                        class="col-span-full flex items-center gap-2 px-3 py-2 border-t border-default-background-separator">
                        <Button
                            variant="ghost"
                            size="sm"
                            class="text-text-secondary"
                            @click="handleAddRow">
                            <PlusIcon class="h-4 w-4 mr-1 text-icon-default" />
                            Add row
                        </Button>
                    </div>

                    <!-- Totals row -->
                    <div
                        class="px-3 py-2.5 text-sm font-semibold text-text-primary border-t border-default-background-separator sticky left-0 bg-card-background z-10">
                        Total
                    </div>
                    <div
                        v-for="(total, dayIndex) in dayTotals"
                        :key="dayIndex"
                        data-testid="timesheet_day_total"
                        :class="[
                            'px-2 py-2.5 text-center text-sm font-medium border-t border-l border-default-background-separator',
                            weekDays[dayIndex] === todayDate
                                ? 'bg-card-background/50 text-text-primary'
                                : 'text-text-secondary',
                        ]">
                        {{ total > 0 ? formatDuration(total) : '-' }}
                    </div>
                    <div
                        class="px-3 py-2.5 text-right text-sm font-semibold text-text-primary border-t border-l border-default-background-separator">
                        {{ weekTotalFormatted }}
                    </div>
                </div>
            </div>

            <!-- Copy last week dropdown (below the table) -->
            <div v-if="!isPending" class="mt-3 flex items-center">
                <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                        <Button
                            variant="outline"
                            size="sm"
                            :disabled="isCopyingLastWeek">
                            <DocumentDuplicateIcon class="h-4 w-4 mr-1.5 text-icon-default" />
                            Copy last week
                            <ChevronDownIcon class="h-3.5 w-3.5 ml-1 text-icon-default" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" class="min-w-[220px]">
                        <DropdownMenuItem
                            class="flex items-center space-x-3 cursor-pointer"
                            @click="copyLastWeekRows">
                            <ListBulletIcon class="w-5 text-icon-default" />
                            <span>Copy rows only</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            class="flex items-center space-x-3 cursor-pointer"
                            @click="copyLastWeekWithTime">
                            <ClockIcon class="w-5 text-icon-default" />
                            <span>Copy rows and time entries</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <!-- Loading state -->
            <div v-else-if="isPending" class="flex justify-center items-center py-12">
                <LoadingSpinner />
            </div>

            <!-- Empty state (no rows after loading) -->
            <div
                v-if="!isPending && rows.length === 0"
                class="text-center pt-8 pb-4">
                <TableCellsIcon class="w-8 text-icon-default inline pb-2" />
                <h3 class="text-text-primary font-semibold">No time entries this week</h3>
                <p class="pb-4 text-text-secondary">Add a row to start tracking time</p>
                <Button
                    variant="outline"
                    size="sm"
                    @click="handleAddRow">
                    <PlusIcon class="h-4 w-4 mr-1 text-icon-default" />
                    Add row
                </Button>
            </div>
        </MainContainer>

        <!-- Delete confirmation dialog -->
        <AlertDialog v-model:open="showDeleteDialog">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Remove timesheet row?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will delete {{ getDeleteRowEntryCount() }} time
                        {{ getDeleteRowEntryCount() === 1 ? 'entry' : 'entries' }}
                        for "{{ getDeleteRowProjectName() }}" this week.
                        This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        @click="confirmDeleteRow">
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </AppLayout>
</template>
