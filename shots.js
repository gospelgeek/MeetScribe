// Screenshots de las reuniones. Se guardan en IndexedDB (no en chrome.storage) para no
// engordar la lectura de todas las reuniones cada vez que algo cambia.
// Lo usan el proceso de fondo (guarda) y la página de reuniones (muestra y borra).

const ShotsDB = (() => {
  const open = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open('meetscribe', 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('shots', { keyPath: 'id', autoIncrement: true });
        store.createIndex('code', 'code');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  // Ejecuta fn(store) dentro de una transacción y espera a que termine.
  async function run(mode, fn) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('shots', mode);
        const result = fn(tx.objectStore('shots'));
        tx.oncomplete = () => resolve(result.result);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  return {
    add: (code, ts, blob) => run('readwrite', (s) => s.add({ code, ts, blob })),
    // Capturas de una reunión, de la más antigua a la más reciente.
    list: async (code) =>
      (await run('readonly', (s) => s.index('code').getAll(code))).sort((a, b) => a.ts - b.ts),
    remove: async (code) => {
      const db = await open();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('shots', 'readwrite');
          const store = tx.objectStore('shots');
          const req = store.index('code').openKeyCursor(IDBKeyRange.only(code));
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            store.delete(cursor.primaryKey);
            cursor.continue();
          };
          tx.oncomplete = resolve;
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
  };
})();
