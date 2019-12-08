import {IdPair, SanityDocument} from './types'
import {BufferedDocumentEvent, BufferedDocumentWrapper} from './buffered-doc/createBufferedDocument'
import {SnapshotEvent} from './buffered-doc/types'
import docStore from './document-store'
import {defer, merge, Observable} from 'rxjs'
import {filter, map, scan, tap} from 'rxjs/operators'

interface LocalDocument {
  snapshot: SanityDocument | null
  patch: (patches) => void
  create: (document) => void
  createIfNotExists: (document) => void
  createOrReplace: (document) => void
  delete: () => void
  commit: () => Observable<never>
}

export interface LocalPair {
  id: string
  draft: LocalDocument
  published: LocalDocument
}

function isSnapshotEvent(event: BufferedDocumentEvent): event is SnapshotEvent {
  return event.type == 'snapshot'
}

function isLocalPair(event: any): event is LocalPair {
  return 'draft' in event && 'published' in event
}

function toLocalDocument(bdw: BufferedDocumentWrapper) {
  return bdw.events.pipe(
    filter(isSnapshotEvent),
    map(draftEvent => ({
      snapshot: draftEvent.document,
      patch: bdw.patch,
      create: bdw.create,
      createIfNotExists: bdw.createIfNotExists,
      createOrReplace: bdw.createOrReplace,
      delete: bdw.delete,
      commit: bdw.commit
    }))
  )
}

function createCache<T>() {
  const CACHE: {[key: string]: Observable<T>} = Object.create(null)
  return function cacheBy(id: string) {
    return (input$: Observable<T>): Observable<T> => {
      return defer(() => {
        if (!(id in CACHE)) {
          CACHE[id] = input$.pipe(
            tap({
              complete: () => {
                delete CACHE[id]
              }
            })
          )
        }
        return CACHE[id]
      })
    }
  }
}

function query(params: {}) {
  return {}
}

query({foo: 'bar'})

const cacheBy = createCache<LocalPair>()
export function getPair(idPair: IdPair): Observable<LocalPair> {
  return defer(() => {
    const {draft, published} = docStore.checkoutPair(idPair)
    const draftEvents$ = toLocalDocument(draft).pipe(map(ev => ({draft: ev})))
    const publishedEvents$ = toLocalDocument(published).pipe(map(ev => ({published: ev})))
    return merge(draftEvents$, publishedEvents$).pipe(
      scan((prev, curr) => ({...prev, ...curr}), {}),
      filter(isLocalPair)
    )
  }).pipe(cacheBy(idPair.publishedId))
}
