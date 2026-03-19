import { browser } from '$app/environment';

const DB_NAME = 'chess-clock-redux-actions';
const DB_VERSION = 1;
const STORE_NAME = 'redux_actions';
const GAME_INDEX = 'by_game';

export type ReduxActionLogRecord = {
	id?: number;
	gameId: string;
	recordedAtMs: number;
	type: string;
	payload: unknown;
};

function openActionLogDb(): Promise<IDBDatabase> {
	if (!browser || typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is unavailable.'));
	}

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => {
			reject(request.error ?? new Error('Failed to open IndexedDB.'));
		};

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, {
					keyPath: 'id',
					autoIncrement: true
				});
				store.createIndex(GAME_INDEX, 'gameId', { unique: false });
			}
		};

		request.onsuccess = () => {
			resolve(request.result);
		};
	});
}

function withStore<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
) {
	return openActionLogDb().then((db) => new Promise<T>((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, mode);
		const store = transaction.objectStore(STORE_NAME);
		run(store, resolve, reject);
		transaction.oncomplete = () => db.close();
		transaction.onerror = () => {
			reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
			db.close();
		};
		transaction.onabort = () => {
			reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
			db.close();
		};
	}));
}

export function appendReduxActionLog(record: ReduxActionLogRecord) {
	if (!browser) return Promise.resolve();

	return withStore<void>('readwrite', (store, resolve, reject) => {
		const request = store.add(record);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error('Failed to append redux action log.'));
	});
}

export function listReduxActionLogs(gameId: string) {
	if (!browser) return Promise.resolve([] as ReduxActionLogRecord[]);

	return withStore<ReduxActionLogRecord[]>('readonly', (store, resolve, reject) => {
		const index = store.index(GAME_INDEX);
		const request = index.getAll(IDBKeyRange.only(gameId));
		request.onsuccess = () => {
			const rows = (request.result as ReduxActionLogRecord[]).sort((a, b) => {
				if (a.recordedAtMs !== b.recordedAtMs) {
					return a.recordedAtMs - b.recordedAtMs;
				}
				return (a.id ?? 0) - (b.id ?? 0);
			});
			resolve(rows);
		};
		request.onerror = () => reject(request.error ?? new Error('Failed to read redux action logs.'));
	});
}
