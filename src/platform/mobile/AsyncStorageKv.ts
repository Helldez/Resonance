import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IKeyValueStore } from '@core/ports/IKeyValueStore';

export class AsyncStorageKv implements IKeyValueStore {
  async get(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }
  async set(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  }
  async delete(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }
}
