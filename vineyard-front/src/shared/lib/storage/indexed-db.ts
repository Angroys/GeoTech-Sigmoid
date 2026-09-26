export type ObjectStore = {
  getAll: () => Promise<unknown[]>;
  get: (key: string) => Promise<unknown>;
  put: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

export const createObjectStore = (databaseName: string, storeName: string): ObjectStore => {
  let database: Promise<IDBDatabase> | null = null;

  const open = () => {
    database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = null;
        reject(request.error ?? new Error("IndexedDB could not be opened"));
      };
    });
    return database;
  };

  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return requestToPromise(action(db.transaction(storeName, mode).objectStore(storeName)));
  };

  return {
    getAll: () => run("readonly", store => store.getAll()),
    get: key => run("readonly", store => store.get(key)),
    put: async (key, value) => {
      await run("readwrite", store => store.put(value, key));
    },
    remove: async key => {
      await run("readwrite", store => store.delete(key));
    },
  };
};
