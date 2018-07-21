import { createStore } from '../genericStore'
import { baseEncoding } from './baseEncoding'
import { frame } from './frame'
import { x } from './x'
import { y } from './y'
import { size } from './size'
import { color } from './color'

export const encodingStore = createStore(baseEncoding, {
    frame,
    x,
    y,
    color,
    size
});