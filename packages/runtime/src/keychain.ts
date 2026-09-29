export interface Keychain {
  available(): Promise<boolean>;
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, value: string): Promise<void>;
  delete(service: string, account: string): Promise<boolean>;
}

export class MemoryKeychain implements Keychain {
  readonly #store = new Map<string, string>();
  available(): Promise<boolean> {
    return Promise.resolve(true);
  }
  get(service: string, account: string): Promise<string | null> {
    return Promise.resolve(this.#store.get(`${service}\0${account}`) ?? null);
  }
  set(service: string, account: string, value: string): Promise<void> {
    this.#store.set(`${service}\0${account}`, value);
    return Promise.resolve();
  }
  delete(service: string, account: string): Promise<boolean> {
    return Promise.resolve(this.#store.delete(`${service}\0${account}`));
  }
}

interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): boolean | undefined;
}
interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

/**
 * OS keychain via @napi-rs/keyring (Node-API, so it also loads in Electron without a rebuild).
 * Loaded lazily: machines without a Secret Service / keychain report `available() === false`.
 */
export class OsKeychain implements Keychain {
  #mod: Promise<KeyringModule | null> | undefined;

  private load(): Promise<KeyringModule | null> {
    this.#mod ??= import('@napi-rs/keyring').then(
      (m) => m as unknown as KeyringModule,
      () => null,
    );
    return this.#mod;
  }

  async available(): Promise<boolean> {
    const mod = await this.load();
    if (!mod) return false;
    try {
      new mod.Entry('incubator', '__probe__').getPassword();
      return true;
    } catch {
      return false;
    }
  }

  async get(service: string, account: string): Promise<string | null> {
    const mod = await this.load();
    if (!mod) return null;
    try {
      return new mod.Entry(service, account).getPassword() ?? null;
    } catch {
      return null;
    }
  }

  async set(service: string, account: string, value: string): Promise<void> {
    const mod = await this.load();
    if (!mod) throw new Error('OS keychain is not available on this machine');
    new mod.Entry(service, account).setPassword(value);
  }

  async delete(service: string, account: string): Promise<boolean> {
    const mod = await this.load();
    if (!mod) return false;
    try {
      return new mod.Entry(service, account).deletePassword() ?? true;
    } catch {
      return false;
    }
  }
}
