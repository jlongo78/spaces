import * as lancedb from '@lancedb/lancedb';
import * as arrow from 'apache-arrow';
import path from 'path';
import fs from 'fs';
import type { KnowledgeUnit, Layer } from './knowledge/types';

const TABLE_NAME = 'knowledge';

/** Build an Arrow schema for the knowledge table at a given vector dimension. */
function buildSchema(dimensions: number): arrow.Schema {
  return new arrow.Schema([
    new arrow.Field('id', new arrow.Utf8(), false),
    new arrow.Field(
      'vector',
      new arrow.FixedSizeList(dimensions, new arrow.Field('item', new arrow.Float32(), true)),
      false,
    ),
    new arrow.Field('text', new arrow.Utf8(), false),
    new arrow.Field('type', new arrow.Utf8(), false),
    new arrow.Field('layer', new arrow.Utf8(), false),
    new arrow.Field('workspace_id', new arrow.Int32(), true),
    new arrow.Field('session_id', new arrow.Utf8(), true),
    new arrow.Field('agent_type', new arrow.Utf8(), false),
    new arrow.Field('project_path', new arrow.Utf8(), true),
    new arrow.Field('file_refs', new arrow.Utf8(), false),
    new arrow.Field('confidence', new arrow.Float64(), false),
    new arrow.Field('created', new arrow.Utf8(), false),
    new arrow.Field('source_timestamp', new arrow.Utf8(), false),
    new arrow.Field('stale_score', new arrow.Float64(), false),
    new arrow.Field('access_count', new arrow.Int32(), false),
    new arrow.Field('last_accessed', new arrow.Utf8(), false),
    new arrow.Field('metadata', new arrow.Utf8(), false),
    // v2 fields (nullable)
    new arrow.Field('scope', new arrow.Utf8(), true),
    new arrow.Field('entity_links', new arrow.Utf8(), true),
    new arrow.Field('evidence_score', new arrow.Float64(), true),
    new arrow.Field('corroborations', new arrow.Int32(), true),
    new arrow.Field('contradiction_refs', new arrow.Utf8(), true),
    new arrow.Field('sensitivity', new arrow.Utf8(), true),
    new arrow.Field('creator_scope', new arrow.Utf8(), true),
    new arrow.Field('origin', new arrow.Utf8(), true),
    new arrow.Field('propagation_path', new arrow.Utf8(), true),
  ]);
}

export class CortexStore {
  private baseDir: string;
  private connections = new Map<string, lancedb.Connection>();
  private dimensions: number = 384;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async init(dimensions: number): Promise<void> {
    this.dimensions = dimensions;
    // Ensure layer directories exist
    for (const layer of ['personal', 'workspace', 'team']) {
      const dir = path.join(this.baseDir, layer);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private async getConnection(layerPath: string): Promise<lancedb.Connection> {
    if (!this.connections.has(layerPath)) {
      const dir = path.join(this.baseDir, layerPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const conn = await lancedb.connect(dir);
      this.connections.set(layerPath, conn);
    }
    return this.connections.get(layerPath)!;
  }

  /** Resolve layer path: 'personal' or 'workspace/123' or 'team'. */
  private layerPath(layer: Layer, workspaceId?: number | null): string {
    if (layer === 'workspace' && workspaceId) {
      return path.join('workspace', String(workspaceId));
    }
    return layer;
  }

  private unitToRecord(unit: KnowledgeUnit): Record<string, unknown> {
    return {
      id: unit.id,
      vector: unit.vector,
      text: unit.text,
      type: unit.type,
      layer: unit.layer,
      workspace_id: unit.workspace_id,   // null preserved — schema declares nullable Int32
      session_id: unit.session_id,
      agent_type: unit.agent_type,
      project_path: unit.project_path,
      file_refs: JSON.stringify(unit.file_refs),
      confidence: unit.confidence,
      created: unit.created,
      source_timestamp: unit.source_timestamp,
      stale_score: unit.stale_score,
      access_count: unit.access_count,
      last_accessed: unit.last_accessed ?? '',
      metadata: JSON.stringify(unit.metadata),
      // v2 fields
      scope: unit.scope ? JSON.stringify(unit.scope) : '',
      entity_links: JSON.stringify(unit.entity_links ?? []),
      evidence_score: unit.evidence_score ?? 0.5,
      corroborations: unit.corroborations ?? 0,
      contradiction_refs: JSON.stringify(unit.contradiction_refs ?? []),
      sensitivity: unit.sensitivity ?? 'internal',
      creator_scope: unit.creator_scope ? JSON.stringify(unit.creator_scope) : '',
      origin: unit.origin ? JSON.stringify(unit.origin) : '',
      propagation_path: JSON.stringify(unit.propagation_path ?? []),
    };
  }

  async add(layerKey: string, unit: KnowledgeUnit): Promise<void> {
    const conn = await this.getConnection(layerKey);
    const tableNames = await conn.tableNames();
    const record = this.unitToRecord(unit);

    if (tableNames.includes(TABLE_NAME)) {
      const table = await conn.openTable(TABLE_NAME);
      await table.add([record]);
    } else {
      const schema = buildSchema(this.dimensions);
      const arrowTable = lancedb.makeArrowTable([record], { schema });
      await conn.createTable(TABLE_NAME, arrowTable);
    }
  }

  async search(
    layerKey: string,
    queryVector: number[],
    limit: number,
    filter?: string,
  ): Promise<KnowledgeUnit[]> {
    const conn = await this.getConnection(layerKey);
    const tableNames = await conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return [];

    const table = await conn.openTable(TABLE_NAME);
    let query = table.vectorSearch(queryVector).limit(limit);
    if (filter) {
      query = query.where(filter);
    }
    const rows = await query.toArray();

    return rows.map((row: any) => ({
      ...row,
      file_refs: JSON.parse(row.file_refs || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      last_accessed: row.last_accessed || null,
      // v2 fields
      scope: row.scope ? JSON.parse(row.scope) : undefined,
      entity_links: row.entity_links ? JSON.parse(row.entity_links) : [],
      evidence_score: row.evidence_score ?? 0.5,
      corroborations: row.corroborations ?? 0,
      contradiction_refs: row.contradiction_refs ? JSON.parse(row.contradiction_refs) : [],
      sensitivity: row.sensitivity || 'internal',
      creator_scope: row.creator_scope ? JSON.parse(row.creator_scope) : null,
      origin: row.origin ? JSON.parse(row.origin) : undefined,
      propagation_path: row.propagation_path ? JSON.parse(row.propagation_path) : [],
    }));
  }

  async browse(layerKey: string, limit: number): Promise<KnowledgeUnit[]> {
    const conn = await this.getConnection(layerKey);
    const tableNames = await conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return [];

    const table = await conn.openTable(TABLE_NAME);
    const rows = await table.query().limit(limit).toArray();

    return rows.map((row: any) => ({
      ...row,
      file_refs: JSON.parse(row.file_refs || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      last_accessed: row.last_accessed || null,
      // v2 fields
      scope: row.scope ? JSON.parse(row.scope) : undefined,
      entity_links: row.entity_links ? JSON.parse(row.entity_links) : [],
      evidence_score: row.evidence_score ?? 0.5,
      corroborations: row.corroborations ?? 0,
      contradiction_refs: row.contradiction_refs ? JSON.parse(row.contradiction_refs) : [],
      sensitivity: row.sensitivity || 'internal',
      creator_scope: row.creator_scope ? JSON.parse(row.creator_scope) : null,
      origin: row.origin ? JSON.parse(row.origin) : undefined,
      propagation_path: row.propagation_path ? JSON.parse(row.propagation_path) : [],
    }));
  }

  async delete(layerKey: string, id: string): Promise<void> {
    const conn = await this.getConnection(layerKey);
    const tableNames = await conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return;

    const table = await conn.openTable(TABLE_NAME);
    // Sanitize id to prevent filter injection (LanceDB uses string filters)
    const safeId = id.replace(/'/g, "''");
    await table.delete(`id = '${safeId}'`);
  }

  async updateAccessCount(layerKey: string, id: string): Promise<void> {
    const conn = await this.getConnection(layerKey);
    const tableNames = await conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return;

    const table = await conn.openTable(TABLE_NAME);
    const safeId = id.replace(/'/g, "''");
    // LanceDB doesn't support UPDATE; delete + re-add with bumped count
    // Use query().where() instead of vectorSearch to avoid dimension dependency
    const rows = await table.query()
      .where(`id = '${safeId}'`).limit(1).toArray();
    if (rows.length === 0) return;

    const raw = rows[0];
    await table.delete(`id = '${safeId}'`);
    // Reconstruct a plain record to avoid Arrow metadata fields rejected by table.add()
    const record: Record<string, unknown> = {
      id: raw.id,
      vector: Array.from(raw.vector as Iterable<number>),
      text: raw.text,
      type: raw.type,
      layer: raw.layer,
      workspace_id: raw.workspace_id ?? null,
      session_id: raw.session_id ?? null,
      agent_type: raw.agent_type,
      project_path: raw.project_path ?? null,
      file_refs: raw.file_refs,
      confidence: raw.confidence,
      created: raw.created,
      source_timestamp: raw.source_timestamp,
      stale_score: raw.stale_score,
      access_count: (raw.access_count || 0) + 1,
      last_accessed: new Date().toISOString(),
      metadata: raw.metadata,
      // v2 fields — pass through raw string values (already serialized)
      scope: raw.scope ?? '',
      entity_links: raw.entity_links ?? '[]',
      evidence_score: raw.evidence_score ?? 0.5,
      corroborations: raw.corroborations ?? 0,
      contradiction_refs: raw.contradiction_refs ?? '[]',
      sensitivity: raw.sensitivity ?? 'internal',
      creator_scope: raw.creator_scope ?? '',
      origin: raw.origin ?? '',
      propagation_path: raw.propagation_path ?? '[]',
    };
    await table.add([record]);
  }

  async stats(): Promise<Record<string, { count: number }>> {
    const result: Record<string, { count: number }> = {};
    for (const layer of ['personal', 'workspace', 'team']) {
      try {
        const conn = await this.getConnection(layer);
        const tableNames = await conn.tableNames();
        if (tableNames.includes(TABLE_NAME)) {
          const table = await conn.openTable(TABLE_NAME);
          const count = await table.countRows();
          result[layer] = { count };
        } else {
          result[layer] = { count: 0 };
        }
      } catch {
        result[layer] = { count: 0 };
      }
    }
    return result;
  }

  async close(): Promise<void> {
    // LanceDB connections are lightweight file handles;
    // clearing the map releases our references so GC can collect them.
    // If lancedb adds an explicit close() in future, call it here.
    this.connections.clear();
  }
}
