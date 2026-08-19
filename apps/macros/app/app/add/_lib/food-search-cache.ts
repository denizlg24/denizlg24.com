"use client"

import { z } from "zod"

import {
  type FoodSearchItem,
  type FoodSearchParams,
  foodSearchItemSchema,
} from "@/lib/foods/contracts"

const dbName = "macros-food-search"
const dbVersion = 2
const queryStore = "queries"
const itemStore = "items"
const userCreatedFoodStore = "userCreatedFoods"
const maxCachedQueryAgeMs = 1000 * 60 * 60 * 24 * 14

const cachedSearchEntrySchema = z.object({
  key: z.string(),
  params: z.object({
    q: z.string().optional(),
    brand: z.string().optional(),
    lang: z.enum(["english", "portuguese", "spanish", "french"]).optional(),
    limit: z.number(),
    minScore: z.number().optional(),
  }),
  itemIds: z.array(z.uuid()),
  fetchedAt: z.string(),
  expiresAt: z.number(),
})

const cachedFoodItemSchema = z.object({
  item: foodSearchItemSchema,
  fetchedAt: z.string(),
})

type CachedSearchEntry = z.infer<typeof cachedSearchEntrySchema>
type CachedFoodItem = z.infer<typeof cachedFoodItemSchema>
type CachedUserCreatedFood = CachedFoodItem

function openFoodCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(queryStore)) {
        database.createObjectStore(queryStore, { keyPath: "key" })
      }

      if (!database.objectStoreNames.contains(itemStore)) {
        database.createObjectStore(itemStore, { keyPath: "item.id" })
      }

      if (!database.objectStoreNames.contains(userCreatedFoodStore)) {
        database.createObjectStore(userCreatedFoodStore, { keyPath: "item.id" })
      }
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function readStoreValues(storeName: string, keys: string[]) {
  return new Promise<unknown[]>((resolve, reject) => {
    if (keys.length === 0) {
      resolve([])
      return
    }

    openFoodCache()
      .then((database) => {
        const transaction = database.transaction(storeName, "readonly")
        const store = transaction.objectStore(storeName)
        const values = new Array<unknown>(keys.length)

        keys.forEach((key, index) => {
          const request = store.get(key)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            values[index] = request.result
          }
        })

        transaction.oncomplete = () => {
          database.close()
          resolve(values)
        }
        transaction.onerror = () => {
          database.close()
          reject(transaction.error)
        }
      })
      .catch(reject)
  })
}

function writeValues(
  writes: Array<{
    storeName: string
    value: CachedSearchEntry | CachedFoodItem | CachedUserCreatedFood
  }>
) {
  return new Promise<void>((resolve, reject) => {
    openFoodCache()
      .then((database) => {
        const storeNames = [...new Set(writes.map((write) => write.storeName))]
        const transaction = database.transaction(storeNames, "readwrite")

        for (const write of writes) {
          transaction.objectStore(write.storeName).put(write.value)
        }

        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => {
          database.close()
          reject(transaction.error)
        }
      })
      .catch(reject)
  })
}

export function getFoodSearchCacheKey(params: FoodSearchParams) {
  const normalized = {
    q: params.q?.trim().toLowerCase() || undefined,
    brand: params.brand?.trim().toLowerCase() || undefined,
    lang: params.lang,
    limit: params.limit,
    minScore: params.minScore,
  }

  return JSON.stringify(normalized)
}

export async function getCachedFoodSearch(params: FoodSearchParams) {
  if (typeof indexedDB === "undefined") {
    return null
  }

  const key = getFoodSearchCacheKey(params)
  const [rawEntry] = await readStoreValues(queryStore, [key])
  const entry = cachedSearchEntrySchema.safeParse(rawEntry)

  if (!entry.success || entry.data.expiresAt < Date.now()) {
    return null
  }

  const cachedItems = await readStoreValues(itemStore, entry.data.itemIds)
  const items: FoodSearchItem[] = []
  for (const value of cachedItems) {
    const cachedItem = cachedFoodItemSchema.safeParse(value)

    if (cachedItem.success) {
      items.push(cachedItem.data.item)
    }
  }

  return {
    items,
    itemIds: entry.data.itemIds,
    fetchedAt: entry.data.fetchedAt,
  }
}

export async function putCachedFoodSearch(
  params: FoodSearchParams,
  items: FoodSearchItem[],
  fetchedAt: string
) {
  if (typeof indexedDB === "undefined") {
    return
  }

  const key = getFoodSearchCacheKey(params)
  await writeValues([
    {
      storeName: queryStore,
      value: {
        key,
        params,
        itemIds: items.map((item) => item.id),
        fetchedAt,
        expiresAt: Date.now() + maxCachedQueryAgeMs,
      },
    },
    ...items.map((item) => ({
      storeName: itemStore,
      value: { item, fetchedAt },
    })),
  ])
}

export async function updateCachedFoodItems(
  items: FoodSearchItem[],
  fetchedAt: string
) {
  if (typeof indexedDB === "undefined" || items.length === 0) {
    return
  }

  await writeValues(
    items.map((item) => ({
      storeName: itemStore,
      value: { item, fetchedAt },
    }))
  )
}

export async function putUserCreatedFood(
  item: FoodSearchItem,
  fetchedAt: string
) {
  if (typeof indexedDB === "undefined") {
    return
  }

  await writeValues([
    {
      storeName: userCreatedFoodStore,
      value: { item, fetchedAt },
    },
    {
      storeName: itemStore,
      value: { item, fetchedAt },
    },
  ])
}

export function getUserCreatedFoods() {
  return new Promise<FoodSearchItem[]>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve([])
      return
    }

    openFoodCache()
      .then((database) => {
        const transaction = database.transaction(
          userCreatedFoodStore,
          "readonly"
        )
        const request = transaction.objectStore(userCreatedFoodStore).getAll()

        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const items = request.result
            .map((value: unknown) => cachedFoodItemSchema.safeParse(value))
            .filter((result) => result.success)
            .map((result) => result.data.item)
          resolve(items)
        }

        transaction.oncomplete = () => database.close()
        transaction.onerror = () => {
          database.close()
          reject(transaction.error)
        }
      })
      .catch(reject)
  })
}
