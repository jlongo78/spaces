import type { Table } from '@lancedb/lancedb';

const V2_COLUMNS: [string, string][] = [
  ['scope', "''"],
  ['entity_links', "'[]'"],
  ['evidence_score', '0.5'],
  ['corroborations', '0'],
  ['contradiction_refs', "'[]'"],
  ['sensitivity', "'internal'"],
  ['creator_scope', "''"],
  ['origin', "''"],
  ['propagation_path', "'[]'"],
];

export async function migrateTableToV2(table: Table): Promise<void> {
  const schema = await table.schema();
  const existingFields = new Set(schema.fields.map((f: any) => f.name));

  for (const [colName, defaultExpr] of V2_COLUMNS) {
    if (!existingFields.has(colName)) {
      try {
        await (table as any).addColumns([{ name: colName, valueSql: defaultExpr }]);
      } catch {
        // Column may have been added concurrently, or addColumns not supported
      }
    }
  }
}
