<script setup lang="ts">
import {
    formatHumanReadableDuration,
    parseTimeInput,
} from '@/packages/ui/src/utils/time';
import { computed, ref, inject, type ComputedRef } from 'vue';
import type { Organization } from '@/packages/api/src';
import type { TimesheetCell } from '@/utils/useTimesheetGrid';

const organization = inject<ComputedRef<Organization>>('organization');

const organizationSettings = computed(() => ({
    intervalFormat: organization?.value?.interval_format ?? 'hours-minutes',
    numberFormat: organization?.value?.number_format ?? 'point',
}));

const props = defineProps<{
    cell?: TimesheetCell;
    dayIndex: number;
    date: string;
    isToday: boolean;
    hasRunningEntry: boolean;
}>();

const emit = defineEmits<{
    update: [newSeconds: number];
}>();

const temporaryValue = ref<string>('');
const isEditing = ref(false);

const displayValue = computed({
    get() {
        if (temporaryValue.value !== '') {
            return temporaryValue.value;
        }
        if (!props.cell || props.cell.totalSeconds === 0) {
            return '';
        }
        return formatHumanReadableDuration(
            props.cell.totalSeconds,
            organizationSettings.value.intervalFormat,
            organizationSettings.value.numberFormat
        );
    },
    set(newValue) {
        temporaryValue.value = newValue;
    },
});

function selectInput(event: Event) {
    isEditing.value = true;
    const target = event.target as HTMLInputElement;
    target.select();
}

function commitValue() {
    isEditing.value = false;
    const input = temporaryValue.value.trim();
    temporaryValue.value = '';

    if (input === '') {
        return;
    }

    if (input === '0') {
        emit('update', 0);
        return;
    }

    const defaultUnit =
        organizationSettings.value.intervalFormat === 'decimal' ? 'hours' : 'minutes';
    const seconds = parseTimeInput(input, defaultUnit);
    if (seconds !== null && seconds >= 0) {
        emit('update', seconds);
    }
}

function cancelEdit(event: Event) {
    temporaryValue.value = '';
    isEditing.value = false;
    (event.target as HTMLInputElement).blur();
}
</script>

<template>
    <div
        data-testid="timesheet_cell"
        :class="[
            'flex items-center justify-center border-l border-default-background-separator',
            isToday ? 'bg-card-background/50' : '',
        ]">
        <input
            v-model="displayValue"
            :disabled="hasRunningEntry"
            :placeholder="isEditing ? '0' : '-'"
            class="w-[80px] mx-auto px-1.5 py-1.5 text-center text-sm font-medium
                bg-transparent text-text-primary placeholder:text-text-quaternary
                rounded-lg border border-transparent
                hover:bg-card-background hover:border-card-border
                focus-visible:bg-tertiary focus-visible:border-transparent
                focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
                disabled:opacity-50 disabled:cursor-not-allowed"
            @focus="selectInput"
            @blur="commitValue"
            @keydown.enter.prevent="commitValue"
            @keydown.escape="cancelEdit" />
    </div>
</template>
