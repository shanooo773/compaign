// Workspace preparation is independent of rolling mailbox sending limits.
export const MESSAGE_CAPACITY = { student: 400, global: 4000 } as const;
export const MESSAGE_CAPACITY_ERROR = `Active message capacity reached (${MESSAGE_CAPACITY.student} per student, ${MESSAGE_CAPACITY.global} globally). Initial drafts and planned follow-ups share this allowance; completed and cancelled history does not count. No paid upgrade is performed.`;

export function checkMessageCapacity(capacity: {student_available:number;global_available:number;existing_import?:boolean}, requested:number) {
 if (!capacity.existing_import && requested > Math.min(capacity.student_available,capacity.global_available)) throw Error(MESSAGE_CAPACITY_ERROR);
}
