import { DataFrameGroup } from "../dataFrameGroup";
import { DataFrame } from "../dataFrame";

// TODO: add check if there are rows that are don't fit stepfn 
// (iterate over df and match one step of stepfn with step of iteration)
export function reindex(df, index) {
    const empty = createEmptyRow(df.fields);
    const result = DataFrame([], df.key);
    const keyConcept = df.key[0]; // supports only single indexed
    for (let key of index) {
        const keyObj = { [keyConcept]: key };
        const row = df.has(keyObj) 
            ? df.get(keyObj)
            : Object.assign({ }, empty, keyObj);
        result.set(row);
    }
    return result;
}

function createEmptyRow(fields) {
    const obj = {};
    for (let field of fields) obj[field] = null;
    return obj;
}

export function reindexGroup(group, index) {
    const newGroup = DataFrameGroup([], group.key, group.descendantKeys);
    for (let i of index) {
        const keyObj = { [newGroup.key[0]]: i };
        const keyStr = newGroup.keyFn(keyObj)
        if (group.has(keyStr)) {
            let member = group.get(keyStr);
            newGroup.set(keyStr, member);
        } else {
            newGroup.createMember(keyStr);
        }
    }
    return newGroup;
}