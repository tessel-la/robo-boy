import type { ActionFieldSchema, ActionGoalDetails } from '../../behaviorTree/services/rosDiscovery';

/** Check supplied fields against retrieved ROS definitions. Omitted fields retain ROS defaults;
 * unknown fields and incompatible values would otherwise be silently dropped by rosbridge. */
export function validatePayload(payload: Record<string, unknown>, schema: ActionGoalDetails): string[] {
  const issues: string[] = [];
  const visit = (value: unknown, fields: ActionFieldSchema[], path: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { issues.push(`${path || 'payload'} must be an object.`); return; }
    for (const [key, entry] of Object.entries(value)) {
      const field = fields.find(item => item.name === key);
      const fieldPath = path ? `${path}.${key}` : key;
      if (!field) { issues.push(`Unknown ROS field ${fieldPath}.`); continue; }
      const scalar = (item: unknown, itemPath: string) => {
        if (field.subfields?.length) visit(item, field.subfields, itemPath);
        else if (/^(?:u?int\d*|float\d*|double|byte|char)$/.test(field.rosType)) {
          if (typeof item !== 'number' || !Number.isFinite(item) || (/^(?:u?int|byte|char)/.test(field.rosType) && !Number.isInteger(item))) issues.push(`${itemPath} must be a finite ${field.rosType}.`);
        } else if (/^(?:string|wstring)$/.test(field.rosType) && typeof item !== 'string') issues.push(`${itemPath} must be a string.`);
        else if (/^(?:bool|boolean)$/.test(field.rosType) && typeof item !== 'boolean') issues.push(`${itemPath} must be a boolean.`);
      };
      if (field.arrayLen >= 0) {
        if (!Array.isArray(entry)) issues.push(`${fieldPath} must be an array.`);
        else {
          if (field.arrayLen > 0 && entry.length !== field.arrayLen) issues.push(`${fieldPath} requires ${field.arrayLen} values.`);
          entry.forEach((item, index) => scalar(item, `${fieldPath}[${index}]`));
        }
      } else scalar(entry, fieldPath);
    }
  };
  visit(payload, schema.fields, '');
  return issues.slice(0, 30);
}
