<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue';
import { XMarkIcon } from '@heroicons/vue/16/solid';
import TimesheetCell from './TimesheetCell.vue';
import TimeTrackerProjectTaskDropdown from '@/packages/ui/src/TimeTracker/TimeTrackerProjectTaskDropdown.vue';
import { formatHumanReadableDuration } from '@/packages/ui/src/utils/time';
import type {
    CreateClientBody,
    CreateProjectBody,
    Project,
    Task,
    Client,
    Organization,
} from '@/packages/api/src';
import type { TimesheetRow, TimesheetRowKey } from '@/utils/useTimesheetGrid';
import { Button } from '@/packages/ui/src/Buttons';

const organization = inject<ComputedRef<Organization>>('organization');

const props = defineProps<{
    row: TimesheetRow;
    weekDays: string[];
    todayDate: string;
    projects: Project[];
    tasks: Task[];
    clients: Client[];
    currency: string;
    canCreateProject: boolean;
    enableEstimatedTime: boolean;
    createProject: (project: CreateProjectBody) => Promise<Project | undefined>;
    createClient: (client: CreateClientBody) => Promise<Client | undefined>;
    runningEntryDates: Set<string>;
}>();

const emit = defineEmits<{
    removeRow: [key: TimesheetRowKey];
    cellUpdate: [dayIndex: number, newSeconds: number];
    projectTaskChange: [projectId: string | null, taskId: string | null];
}>();

const selectedProject = computed({
    get: () => props.row.projectId,
    set: (val) => emit('projectTaskChange', val, selectedTask.value),
});

const selectedTask = computed({
    get: () => props.row.taskId,
    set: (val) => emit('projectTaskChange', selectedProject.value, val),
});

const rowTotalFormatted = computed(() => {
    if (props.row.totalSeconds === 0) return '0 h';
    return formatHumanReadableDuration(
        props.row.totalSeconds,
        organization?.value?.interval_format ?? 'hours-minutes',
        organization?.value?.number_format ?? 'point'
    );
});

function hasRunningEntry(dayIndex: number): boolean {
    const cell = props.row.cells.get(dayIndex);
    if (!cell) return false;
    return cell.entries.some((e) => e.end === null);
}
</script>

<template>
    <div
        data-testid="timesheet_row"
        class="contents group">
        <!-- Project/Task column -->
        <div
            class="flex items-center gap-1 px-3 py-1 border-t border-default-background-separator sticky left-0 bg-card-background z-10">
            <TimeTrackerProjectTaskDropdown
                v-model:project="selectedProject"
                v-model:task="selectedTask"
                :projects="projects"
                :tasks="tasks"
                :clients="clients"
                :currency="currency"
                :can-create-project="canCreateProject"
                :enable-estimated-time="enableEstimatedTime"
                :create-project="createProject"
                :create-client="createClient"
                :allow-reset="true"
                variant="ghost"
                size="sm"
                class="flex-1 min-w-0" />
            <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                @click="emit('removeRow', row.key)">
                <XMarkIcon class="h-3.5 w-3.5 text-icon-default" />
            </Button>
        </div>

        <!-- Day cells -->
        <TimesheetCell
            v-for="(day, dayIndex) in weekDays"
            :key="day"
            :cell="row.cells.get(dayIndex)"
            :day-index="dayIndex"
            :date="day"
            :is-today="day === todayDate"
            :has-running-entry="hasRunningEntry(dayIndex)"
            class="border-t border-default-background-separator"
            @update="(seconds) => emit('cellUpdate', dayIndex, seconds)" />

        <!-- Row total -->
        <div
            data-testid="timesheet_row_total"
            class="flex items-center justify-end px-3 py-2.5 text-sm font-medium text-text-primary border-t border-default-background-separator border-l border-default-background-separator">
            {{ rowTotalFormatted }}
        </div>
    </div>
</template>
