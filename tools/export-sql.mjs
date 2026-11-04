import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const chapter = await readFile(new URL('../books/supabase-claude-prod-review/03-chapter.md', import.meta.url), 'utf8');
const blocks = [...chapter.replace(/\r\n/g, '\n').matchAll(/```sql\n([\s\S]*?)\n```/gu)];
if (blocks.length !== 1) throw new Error('Expected exactly one SQL block in chapter 3; no file written.');
const sql = blocks[0][1];
await mkdir(new URL('../sql/', import.meta.url), { recursive: true });
await writeFile(new URL('../sql/book_tasks.sql', import.meta.url), sql + '\n');
console.log(JSON.stringify({ action: 'SQL_FILE_EXPORTED', databaseApplied: false, sha256: createHash('sha256').update(sql).digest('hex') }, null, 2));
