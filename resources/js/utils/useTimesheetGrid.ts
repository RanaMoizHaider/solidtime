import type { TimeEntry, Project } from '@/packages/api/src';
import { getLocalizedDateFromTimestamp } from '@/packages/ui/src/utils/time';
import { computed, ref, type Ref } from 'vue';

export type TimesheetRowKey = string;

export interface TimesheetCell {
    dayIndex: number;
    date: string;
    entries: TimeEntry[];
    totalSeconds: number;
}

export interface TimesheetRow {
    key: TimesheetRowKey;
    projectId: string | null;
    taskId: string | null;
    cells: Map<number, TimesheetCell>;
    totalSeconds: number;
}

export function makeRowKey(projectId: string | null, taskId: string | null): TimesheetRowKey {
    return `${projectId ?? 'null'}:${taskId ?? 'null'}`;
}

function parseRowKey(key: TimesheetRowKey): { projectId: string | null; taskId: string | null } {
    const [projectId, taskId] = key.split(':');
    return {
        projectId: projectId === 'null' ? null : projectId!,
        taskId: taskId === 'null' ? null : taskId!,
    };
}

export function useTimesheetGrid(
    timeEntries: Ref<TimeEntry[]>,
    weekDays: Ref<string[]>,
    projects: Ref<Project[]>
) {
    const emptyRows = ref<Array<{ projectId: string | null; taskId: string | null }>>([]);

    const rows = computed<TimesheetRow[]>(() => {
        const dayIndexMap = new Map<string, number>();
        weekDays.value.forEach((date, index) => {
            dayIndexMap.set(date, index);
        });

        // Group entries by row key
        const rowMap = new Map<
            TimesheetRowKey,
            Map<number, TimeEntry[]>
        >();

        for (const entry of timeEntries.value) {
            const key = makeRowKey(entry.project_id, entry.task_id);
            const entryDate = getLocalizedDateFromTimestamp(entry.start);
            const dayIndex = dayIndexMap.get(entryDate);

            if (dayIndex === undefined) continue;

            if (!rowMap.has(key)) {
                rowMap.set(key, new Map());
            }
            const dayMap = rowMap.get(key)!;
            if (!dayMap.has(dayIndex)) {
                dayMap.set(dayIndex, []);
            }
            dayMap.get(dayIndex)!.push(entry);
        }

        // Build rows from entries
        const result: TimesheetRow[] = [];

        for (const [key, dayMap] of rowMap) {
            const { projectId, taskId } = parseRowKey(key);
            const cells = new Map<number, TimesheetCell>();
            let totalSeconds = 0;

            for (const [dayIndex, entries] of dayMap) {
                const cellTotal = entries.reduce((sum, e) => sum + (e.duration ?? 0), 0);
                cells.set(dayIndex, {
                    dayIndex,
                    date: weekDays.value[dayIndex]!,
                    entries,
                    totalSeconds: cellTotal,
                });
                totalSeconds += cellTotal;
            }

            result.push({ key, projectId, taskId, cells, totalSeconds });
        }

        // Add empty rows that don't already exist
        for (const emptyRow of emptyRows.value) {
            const key = makeRowKey(emptyRow.projectId, emptyRow.taskId);
            if (!rowMap.has(key)) {
                result.push({
                    key,
                    projectId: emptyRow.projectId,
                    taskId: emptyRow.taskId,
                    cells: new Map(),
                    totalSeconds: 0,
                });
            }
        }

        // Sort: rows with entries first (by project name), empty rows at bottom
        const projectNameMap = new Map<string, string>();
        for (const p of projects.value) {
            projectNameMap.set(p.id, p.name);
        }

        result.sort((a, b) => {
            const aHasEntries = a.totalSeconds > 0;
            const bHasEntries = b.totalSeconds > 0;
            if (aHasEntries !== bHasEntries) return aHasEntries ? -1 : 1;

            const aName = a.projectId ? (projectNameMap.get(a.projectId) ?? '') : '';
            const bName = b.projectId ? (projectNameMap.get(b.projectId) ?? '') : '';
            return aName.localeCompare(bName);
        });

        return result;
    });

    const dayTotals = computed<number[]>(() => {
        return weekDays.value.map((_, dayIndex) => {
            return rows.value.reduce((sum, row) => {
                return sum + (row.cells.get(dayIndex)?.totalSeconds ?? 0);
            }, 0);
        });
    });

    const grandTotal = computed(() => dayTotals.value.reduce((a, b) => a + b, 0));

    function addEmptyRow(projectId: string | null, taskId: string | null) {
        const key = makeRowKey(projectId, taskId);
        const alreadyExists =
            rows.value.some((r) => r.key === key) ||
            emptyRows.value.some(
                (r) => makeRowKey(r.projectId, r.taskId) === key
            );
        if (!alreadyExists) {
            emptyRows.value.push({ projectId, taskId });
        }
    }

    function removeEmptyRow(key: TimesheetRowKey) {
        emptyRows.value = emptyRows.value.filter(
            (r) => makeRowKey(r.projectId, r.taskId) !== key
        );
    }

    function clearEmptyRows() {
        emptyRows.value = [];
    }

    return {
        rows,
        dayTotals,
        grandTotal,
        emptyRows,
        addEmptyRow,
        removeEmptyRow,
        clearEmptyRows,
    };
}
