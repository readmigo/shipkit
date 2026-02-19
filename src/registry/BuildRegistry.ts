/**
 * Build Registry - Tracks uploaded build artifacts with JSON file persistence.
 * Records are stored at ~/.shipkit/builds/registry.json with atomic writes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface BuildRecord {
  artifact_id: string;
  build_id: string;
  store_id: string;
  app_id: string;
  file_path: string;
  sha256: string;
  version_name?: string;
  version_code?: string;
  timestamp: string;
  status: 'uploaded' | 'published' | 'failed';
}

export interface BuildListFilters {
  app_id?: string;
  store_id?: string;
  status?: BuildRecord['status'];
}

const BUILDS_DIR = join(homedir(), '.shipkit', 'builds');
const REGISTRY_PATH = join(BUILDS_DIR, 'registry.json');

export class BuildRegistry {
  private records: BuildRecord[] = [];
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;

    if (!existsSync(REGISTRY_PATH)) {
      this.records = [];
      return;
    }

    try {
      const raw = readFileSync(REGISTRY_PATH, 'utf-8');
      this.records = JSON.parse(raw) as BuildRecord[];
    } catch {
      this.records = [];
    }
  }

  private persist(): void {
    mkdirSync(BUILDS_DIR, { recursive: true });
    const tmpPath = REGISTRY_PATH + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(this.records, null, 2), 'utf-8');
    renameSync(tmpPath, REGISTRY_PATH);
  }

  save(record: BuildRecord): void {
    this.ensureLoaded();
    // Deduplicate: replace existing record with same artifact_id + store_id
    const idx = this.records.findIndex(
      r => r.artifact_id === record.artifact_id && r.store_id === record.store_id,
    );
    if (idx >= 0) {
      this.records[idx] = record;
    } else {
      this.records.push(record);
    }
    this.persist();
  }

  findByBuildId(buildId: string): BuildRecord | undefined {
    this.ensureLoaded();
    return this.records.find(r => r.build_id === buildId);
  }

  findByArtifactId(artifactId: string): BuildRecord | undefined {
    this.ensureLoaded();
    return this.records.find(r => r.artifact_id === artifactId);
  }

  list(filters?: BuildListFilters): BuildRecord[] {
    this.ensureLoaded();
    if (!filters) return [...this.records];

    return this.records.filter(r => {
      if (filters.app_id && r.app_id !== filters.app_id) return false;
      if (filters.store_id && r.store_id !== filters.store_id) return false;
      if (filters.status && r.status !== filters.status) return false;
      return true;
    });
  }
}

export const buildRegistry = new BuildRegistry();
