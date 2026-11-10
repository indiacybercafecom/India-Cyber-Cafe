import { DriveItem } from '../server/driveService';

/**
 * Standardized category priority ranking everywhere in ICC My Documents:
 * 1. Identity Documents (10)
 * 2. Education Documents (20)
 * 3. Government Documents (30)
 * 4. Certificates (40)
 * 5. Banking Documents (50)
 * 6. Personal Documents (60)
 * 7. Custom folders (alphabetically: 500)
 * 8. Other Documents (always last: 999999)
 */
export function getFolderPriorityRank(name: string): number {
  const n = (name || '').trim().toLowerCase();

  // 8. Other Documents (always last)
  if (n === 'other documents' || n === 'other' || n === 'others' || n.startsWith('other')) {
    return 999999;
  }
  // 1. Identity Documents
  if (
    n.includes('identity') ||
    n.includes('aadhaar') ||
    n.includes('pan') ||
    n.includes('voter') ||
    n.includes('passport')
  ) {
    return 10;
  }
  // 2. Education Documents
  if (
    n.includes('education') ||
    n.includes('marksheet') ||
    n.includes('degree') ||
    n.includes('school') ||
    n.includes('college') ||
    n.includes('academic')
  ) {
    return 20;
  }
  // 3. Government Documents
  if (
    n.includes('government') ||
    n.includes('govt') ||
    n.includes('ration') ||
    n.includes('domicile') ||
    n.includes('caste') ||
    n.includes('official')
  ) {
    return 30;
  }
  // 4. Certificates
  if (n.includes('certificate') || n.includes('cert')) {
    return 40;
  }
  // 5. Banking Documents
  if (
    n.includes('bank') ||
    n.includes('banking') ||
    n.includes('financial') ||
    n.includes('passbook') ||
    n.includes('statement') ||
    n.includes('income')
  ) {
    return 50;
  }
  // 6. Personal Documents
  if (
    n.includes('personal') ||
    n.includes('resume') ||
    n.includes('cv') ||
    n.includes('photo') ||
    n.includes('profile')
  ) {
    return 60;
  }
  // 7. Custom folders (alphabetically)
  return 500;
}

/**
 * Consistently sorts folders: Priority categories first, custom folders alphabetically, Other Documents last.
 */
export function sortFolders(folders: DriveItem[]): DriveItem[] {
  return [...folders].sort((a, b) => {
    const rankA = getFolderPriorityRank(a.name);
    const rankB = getFolderPriorityRank(b.name);
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

/**
 * Consistently sorts files: Newest modified date first, with alphabetical name fallback.
 */
export function sortFiles(files: DriveItem[]): DriveItem[] {
  return [...files].sort((a, b) => {
    const tA = new Date(a.modifiedTime || 0).getTime();
    const tB = new Date(b.modifiedTime || 0).getTime();
    if (tB !== tA) return tB - tA;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}
