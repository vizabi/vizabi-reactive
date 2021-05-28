import { createStore } from '../genericStore'
import { baseEncoding } from './baseEncoding'
import { frame } from './frame'
import { selection } from './selection'
import { order } from './order'
import { trail } from './trail'
import { repeat } from './repeat'
import { aggregate } from './aggregate'

export const encodingStore = createStore(baseEncoding, {
    frame,
    selection,
    order,
    trail,
    repeat,
    aggregate
});