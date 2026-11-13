import type { Device, DeviceBridge } from "@jagra/core";
import type { DevicesView } from "../shared/api.js";

/**
 * The device list for every window (DEV-1, DEV-2). It starts watching `adb` the first time a page
 * asks, and keeps watching until Jagra quits, so a phone plugged in shows within seconds.
 */
export class Devices {
  private bridge: DeviceBridge | undefined;
  private stopWatching: (() => void) | undefined;
  private latest: Device[] = [];
  /** A page has asked for the list, so watching should start as soon as adb is known. */
  private wanted = false;

  /**
   * @param makeBridge gives a bridge once the environment check has found adb, else undefined.
   * @param broadcast sends a changed list to every window.
   */
  constructor(
    private readonly makeBridge: () => DeviceBridge | undefined,
    private readonly broadcast: (view: DevicesView) => void,
  ) {}

  watch(): DevicesView {
    this.wanted = true;
    this.bridge ??= this.makeBridge();
    if (this.bridge && !this.stopWatching) {
      this.stopWatching = this.bridge.watch((devices) => {
        this.latest = devices;
        this.broadcast(this.view());
      });
    }
    return this.view();
  }

  /** DEV-2: lists the devices again right away. */
  async refresh(): Promise<DevicesView> {
    this.watch();
    if (this.bridge) {
      const listed = await this.bridge.list();
      if (listed.ok) {
        this.latest = listed.value;
        this.broadcast(this.view());
      }
    }
    return this.view();
  }

  /** After an environment check, starts watching if adb has only now been found. */
  toolsChanged(): void {
    if (this.wanted && !this.bridge && this.watch().adb)
      this.broadcast(this.view());
  }

  close(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  private view(): DevicesView {
    return { adb: this.bridge !== undefined, devices: this.latest };
  }
}
