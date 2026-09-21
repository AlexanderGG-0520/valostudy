import { randomBytes } from "node:crypto";
export function generateStudyId() { return randomBytes(6).toString("hex").slice(0, 11); }
export async function insertWithStudyId<T>(insert: (id: string) => Promise<T | undefined>, generate = generateStudyId): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await insert(generate());
    if (result !== undefined) return result;
  }
  throw new Error("Study ID collision retry limit reached");
}
