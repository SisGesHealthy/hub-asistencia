// IndexedDB de la tablet: empleados (copia local para que el nombre aparezca
// al instante, sin ir a SharePoint), marcaciones (propias y las bajadas de
// la otra tablet) y fotos pendientes de subir.

const DB_NAME = "hub-asistencia";
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("empleados")) db.createObjectStore("empleados", { keyPath: "empleadoId" });
      if (!db.objectStoreNames.contains("registros")) {
        const s = db.createObjectStore("registros", { keyPath: "idLocal" });
        s.createIndex("byEmpleado", "empleadoId");
      }
      if (!db.objectStoreNames.contains("fotos")) db.createObjectStore("fotos", { keyPath: "idLocal" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const r = fn(t.objectStore(storeName));
        t.oncomplete = () => resolve(r?.result);
        t.onerror = () => reject(t.error);
      })
  );
}

export const idb = {
  put: (store, value) => run(store, "readwrite", (s) => s.put(value)).then(() => value),
  get: (store, key) => run(store, "readonly", (s) => s.get(key)).then((v) => v || null),
  getAll: (store) => run(store, "readonly", (s) => s.getAll()).then((v) => v || []),
  getAllByIndex: (store, index, value) =>
    run(store, "readonly", (s) => s.index(index).getAll(value)).then((v) => v || []),
  delete: (store, key) => run(store, "readwrite", (s) => s.delete(key)),
  async replaceAll(store, values) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, "readwrite");
      const s = t.objectStore(store);
      s.clear();
      for (const v of values) s.put(v);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
};
