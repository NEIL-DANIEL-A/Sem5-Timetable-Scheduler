export enum Day {
  Monday = 'Monday',
  Tuesday = 'Tuesday',
  Wednesday = 'Wednesday',
  Thursday = 'Thursday',
  Friday = 'Friday',
  Saturday = 'Saturday',
}

export type SlotType = 'Theory' | 'Lab';

export interface TimeSlot {
  day: Day;
  startTime: string; // "HH:mm" format
  endTime: string;   // "HH:mm" format
  location: string;
  type: SlotType;
}

export interface Teacher {
  id: string;
  name: string;
  department: string;
  group: number;
  slots: TimeSlot[];
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  teachers: Teacher[];
}

export interface SelectionState {
  [subjectId: string]: string | null; // Key: subjectId -> Value: teacherId
}

export type OptimizationStrategy =
  | 'LEAST_DAYS'
  | 'BALANCED_BREAKS'
  | 'EARLY_BIRD'
  | 'NIGHT_OWL';
