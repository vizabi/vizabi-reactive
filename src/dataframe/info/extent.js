import { arrayEquals, createKeyFn, getIter, isGroupedDataFrame, isIterable } from "../dfutils";

/**
 * Get extent (i.e. domain) of a property in an iterable of objects or an iterable nested in a dataFrameGroup. Possibly grouped by a certain other property value, which can be limited to a subset.
 * @param {*} iter 
 * @param {String} concept 
 * @param {String} groupby 
 * @param {[String]} groupSubset 
 * @returns An `[min, max]` array or an object with groupby values as properties and `[min, max]` arrays as values.
 */
export function extent(iter, concept, groupby, groupSubset) {
    if (isGroupedDataFrame(iter))
        return extentGroups(...arguments);
    else 
        return extentIterable(...arguments);
}

function extentGroups(groups, concept, groupBy, groupSubset) {

    return [...getIter(groups)]
        .map(group => extent(group, concept, groupBy, groupSubset))
        .reduce(combineResults);
}
 
function combineResults(one, two) {
    if (Array.isArray(one))
        return [Math.min(one[0], two[0]), Math.max(one[1], two[1])];
    else {
        for (let key in two) {
            if (!(key in one))
                one[key] = two[key];
            else
                one[key] = combineResults(one[key], two[key]);
        }
        return one;
    }
        
}

// in the style of d3.extent
function extentIterable(iter, concept, groupby, groupSubset) {
    iter = getIter(iter);
    let row;

    if (groupby) {
        groupSubset = groupSubset ? Array.from(groupSubset) : groupSubset;
        let keyFn = Array.isArray(groupby) ? createKeyFn(groupby) : undefined;
        let groups = {};
        for (row of iter) {
            const group = keyFn(row);
            if (groupSubset && !groupSubset.includes(group))
                continue;
            if (!groups[group]) groups[group] = [];
            groups[group] = minmax(row[concept], groups[group]);
        }
        return groups
    } else {
        let minmaxArr = [];
        for (row of iter) {
            minmaxArr = minmax(row[concept], minmaxArr);
        }
        return minmaxArr;
    }
}

function minmax(value, [min, max]) {
    
    if (value != null) {
        if (min === undefined) {
            // find first comparable values
            if (value >= value) min = max = value;
        } else {
            // compare remaining values 
            if (min > value) min = value;
            if (max < value) max = value;
        }
    }
    return [min, max]
}

/**
 * Faster extent algorithm for specific grouped dataframes which satisfy:
 *  - grouping by `concept` you want to get extent of (e.g. frame concept)
 *  - each group has `groupBy` as its key (e.g. country-gender)
 *  - grouping is ordered by `concept`
 *  - grouping is interpolated. I.e. every group between min-max contains `groupBy` (e.g. each frame between 2000-2019 contains 'country-usa').
 *  - groupSubSet is given.
 * 
 * Can be used for finding frame-extents of specific markers in frameMap for e.g. trails or timeslider limits
 * @param {*} groups 
 * @param {*} concept 
 * @param {*} groupBy 
 * @param {*} groupSubset 
 * @returns 
 */
 export function extentOfGroupKeyPerMarker(groups, groupSubset, concept = groups.key[0], groupBy = groups.descendantKeys[0]) {
        
    if (!isGroupedDataFrame(groups)) throw("Special case but iterable is not a grouped dataframe");
    const descKeys = groups.descendantKeys
    if (!arrayEquals(groups.key, [concept])) throw("Special case but grouping is not by given concept");
    if (descKeys.length != 1) throw("Special case but grouping is more than 1 level deep");
    if (!arrayEquals(descKeys[0], groupBy)) throw("Special case but grouping members keys is not same as `groupBy`");
    if (!isIterable(groupSubset)) throw("Special case but groupSubset iterable not given.");
    // can't O(1) check ordering & interpolation requirements

    const extents = {};
    for (let groupValue of groupSubset) {
        
        let min, max, group;
        
        for (group of groups.values()) { // each frame
            if (group.hasByObjOrStr(null, groupValue)) { // if frame contains marker
                if (min === undefined) {
                    min = group;
                }
                max = group; // ordered frames, so any subsequent frame is higher
            } else if (min) {
                break; // marker missing, interpolated & ordered frames so won't find marker later either. This is max.
            }
        }

        extents[groupValue] = [min, max].map(group => group?.getByObjOrStr(null, groupValue)[concept]);
    }
    return extents;
}