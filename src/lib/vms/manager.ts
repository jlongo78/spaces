import { InstancesClient, protos } from '@google-cloud/compute';
import { readConfig, type CustomModelConfig } from '../config';

export type VmStatus = 'PROVISIONING' | 'STAGING' | 'RUNNING' | 'STOPPING' | 'SUSPENDING' | 'SUSPENDED' | 'TERMINATED' | 'UNKNOWN';

interface VmState {
  username: string;
  lastActive: number;
}

class VmManager {
  private instancesClient: InstancesClient;
  private state = new Map<string, VmState>();
  private interval: NodeJS.Timeout | null = null;

  constructor() {
    this.instancesClient = new InstancesClient();
    this.startMonitoring();
  }

  private startMonitoring() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.checkInactivity();
    }, 60000); // Check every minute
  }

  private async checkInactivity() {
    const now = Date.now();
    for (const [modelId, state] of this.state.entries()) {
      const config = this.getModelConfig(state.username, modelId);
      if (!config) continue;

      const timeoutMs = (config.timeoutMinutes || 15) * 60 * 1000;
      if (state.lastActive > 0 && now - state.lastActive > timeoutMs) {
        console.log(`[VmManager] Model ${modelId} exceeded inactivity timeout. Stopping...`);
        try {
          await this.stopVm(state.username, modelId);
        } catch (e) {
          console.error(`[VmManager] Failed to auto-stop ${modelId}:`, e);
        }
      }
    }
  }

  public updateActivity(username: string, modelId: string) {
    this.state.set(modelId, { username, lastActive: Date.now() });
  }

  private getModelConfig(username: string, modelId: string): CustomModelConfig | undefined {
    const config = readConfig(username);
    return config.customModels?.find(m => m.id === modelId);
  }

  public async getStatus(username: string, modelId: string): Promise<VmStatus> {
    const config = this.getModelConfig(username, modelId);
    if (!config || config.provider !== 'gcp') return 'UNKNOWN';

    try {
      const [response] = await this.instancesClient.get({
        project: config.gcpProject,
        zone: config.gcpZone,
        instance: config.gcpInstance,
      });
      return (response.status as VmStatus) || 'UNKNOWN';
    } catch (e) {
      console.error(`[VmManager] Failed to get status for ${modelId}:`, e);
      return 'UNKNOWN';
    }
  }

  public async startVm(username: string, modelId: string): Promise<void> {
    const config = this.getModelConfig(username, modelId);
    if (!config || config.provider !== 'gcp') throw new Error(`Model ${modelId} not configured for GCP`);

    const status = await this.getStatus(username, modelId);
    if (status === 'RUNNING' || status === 'PROVISIONING' || status === 'STAGING') {
      this.updateActivity(username, modelId);
      return;
    }

    console.log(`[VmManager] Starting VM for ${modelId}...`);
    try {
      const [operation] = await this.instancesClient.start({
        project: config.gcpProject,
        zone: config.gcpZone,
        instance: config.gcpInstance,
      });
      
      // Wait for the operation to complete
      await operation.promise();
      
      this.updateActivity(username, modelId);
      console.log(`[VmManager] VM for ${modelId} started successfully.`);
    } catch (e) {
      console.error(`[VmManager] Failed to start VM for ${modelId}:`, e);
      throw e;
    }
  }

  public async stopVm(username: string, modelId: string): Promise<void> {
    const config = this.getModelConfig(username, modelId);
    if (!config || config.provider !== 'gcp') return;

    console.log(`[VmManager] Stopping VM for ${modelId}...`);
    try {
      await this.instancesClient.stop({
        project: config.gcpProject,
        zone: config.gcpZone,
        instance: config.gcpInstance,
      });
      this.state.delete(modelId); // Remove from active tracking
      console.log(`[VmManager] VM for ${modelId} stopped successfully.`);
    } catch (e) {
      console.error(`[VmManager] Failed to stop VM for ${modelId}:`, e);
      throw e;
    }
  }
}

export const vmManager = new VmManager();
