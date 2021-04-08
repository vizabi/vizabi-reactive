import { createKeyStr } from "../../dataframe/dfutils";
import { createFilterFn } from "../../dataframe/transforms/filter";
import { isReference, resolveRef } from "../config";
import { fromPromiseAll, isNonNullObject, mode } from "../utils";

/**
 * Finds a config which satisfies both marker.space and encoding.concept autoconfigs
 */
const solveMethods = {}

export const configSolver = {
    addSolveMethod,
    configSolution,
    needsAutoConfig,
    encodingSolution,
    markerPromiseBeforeSolving,
    dataConfigPromisesBeforeSolving
}

function addSolveMethod(fn, name = fn.name) {
    solveMethods[name] = fn;
}

function configSolution(dataConfig) {     
    if (dataConfig.marker) {
        if (dataConfig.hasEncodingMarker) {
            return dataConfig.marker.data.configSolution.encodings[dataConfig.parent.name];
        } else {
            return markerSolution(dataConfig);
        }
    } else {
        // stand-alone dataConfig
        return encodingSolution(dataConfig);
    }
}

function encodingSolution(dataConfig, fallbackSpaceCfg, avoidConcepts = []) {
    let result;
    // const [userSpace, defaultSpace] = splitConfig(this.config, 'space');
    let spaceCfg = "space" in dataConfig.config ? resolveRef(dataConfig.config.space) : fallbackSpaceCfg || dataConfig.defaults.space;
    let conceptCfg = "concept" in dataConfig.config ? dataConfig.config.concept : dataConfig.defaults.concept;

    if (needsSpaceAutoCfg(dataConfig)) {
        result = findSpaceAndConcept(dataConfig, avoidConcepts);
    } else if (needsConceptAutoCfg(dataConfig)) {
        const plainArraySpace = spaceCfg.slice(0);
        result = findConceptForSpace(plainArraySpace, dataConfig, avoidConcepts);
    } else {
        result = {
            space: spaceCfg,
            concept: conceptCfg
        }
    }

    return result;
}

function findMarkerConfigForSpace(markerDataConfig, space) {
    let encodings = {};
    let usedConcepts = [];

    let success = [...Object.entries(markerDataConfig.parent.encoding)].every(([name, enc]) => {
        let encResult = encodingSolution(enc.data, space, usedConcepts);
        if (encResult) {
            encodings[name] = encResult;
            usedConcepts.push(encResult.concept);
            return true;
        }
        return false;
    });

    return success ? { encodings, space } : undefined;
}

function markerSolution(dataConfig) {
    const cfg = dataConfig.config;

    if (!dataConfig.parent.encoding)
        console.warn(`Can't get marker solution for a non-marker dataconfig.`)

    if (needsSpaceAutoCfg(dataConfig)) {

        if (!dataConfig.source) {
            console.warn(`Can't autoconfigure marker space without a source defined.`)
            return;
        }

        return autoConfigSpace(dataConfig, space => findMarkerConfigForSpace(dataConfig, space))

    } else {
        return findMarkerConfigForSpace(dataConfig, cfg.space);
    }
}

function autoConfigSpace(dataConfig, getFurtherResult) {

    const spaceFilter = (dataConfig.config.space && dataConfig.config.space.filter) || (dataConfig.defaults.space && dataConfig.defaults.space.filter);
    const satisfiesSpaceFilter = createFilterFn(spaceFilter);
    const spaces = sortSpacesByPreference(
        [...dataConfig.source.availability.keyLookup.values()] 
    );

    for (let space of spaces) {
        let result;
        if (!space.includes("concept") 
            && space
                .map(c => dataConfig.source.getConcept(c))
                .every(satisfiesSpaceFilter)
            && (result = getFurtherResult(space))
        ) {
            return result
        }
    }
    
    console.warn("Could not autoconfig to a space which also satisfies further results.", { dataConfig, spaceCfg });

    return false;
}

function sortSpacesByPreference(spaces) {
    return spaces.sort((a, b) => a.length > 1 && b.length > 1 ? a.length - b.length : b.length - a.length); // 1-dim in back, rest smallest spaces first
}

function findSpaceAndConcept(dataConfig, avoidConcepts) {

    return autoConfigSpace(dataConfig, space => {
        return findConceptForSpace(space, dataConfig, avoidConcepts)
    })

}

function isConceptAvailableForSpace(dataConfig, space, concept) {
    const keyStr = createKeyStr(space);
    return dataConfig.source.availability.keyValueLookup.get(keyStr).has(concept);
}

function needsSolving(config) {
    config = resolveRef(config);
    return isNonNullObject(config) && !Array.isArray(config);
}

// Add preconfigured often used solver methods 
addSolveMethod(defaultConceptSolver);
addSolveMethod(mostCommonDimensionProperty);
addSolveMethod(selectUnusedConcept);

/**
 * Tries to find encoding concept for a given space, encoding and partial solution which contains concepts to avoid.  
 * Should be called with encoding.data as `this`. 
 * Returns concept id which satisfies encoding definition (incl autoconfig) and does not overlap with partial solution.
 * @param {*} space 
 * @param {*} conceptCfg
 * @param {*} avoidConcepts array of concept ids to avoid in finding autoconfig solution
 * @returns {string} concept id
 */
function findConceptForSpace(space, dataConfig, usedConcepts = []) {
    let concept;
    const conceptCfg = dataConfig.config.concept || dataConfig.defaults.concept;

    if (dataConfig.isConstant()) {
        return { concept: undefined, space };
    } else if (needsSolving(conceptCfg)) {
        const solveConcept = solveMethods[conceptCfg.solveMethod || 'defaultConceptSolver'];
        concept = solveConcept(space, dataConfig, usedConcepts)
    } else if (isConceptAvailableForSpace(dataConfig, space, conceptCfg)) {
        concept = conceptCfg;
    } 

    if (!concept) {
        console.warn("Could not autoconfig concept for given space.", { dataconfig: this, space });
        return false;
    } 

    return { concept, space };
}

function defaultConceptSolver(space, dataConfig, usedConcepts) {

    const dataSource = dataConfig.source;
    const availability = dataSource.availability;
    const conceptCfg = dataConfig.config.concept || dataConfig.defaults.concept;

    const satisfiesFilter = conceptCfg.filter 
        ? createFilterFn(conceptCfg.filter)
        : () => true;

    const filteredConcepts = [...availability.keyValueLookup.get(createKeyStr(space)).keys()]
        // should be able to show space concepts (e.g. time)
        .concat(space)
        // exclude the ones such as "is--country", they won't get resolved
        .filter(concept => concept.substr(0,4) !== "is--")
        // get concept objects
        .map(dataSource.getConcept.bind(dataSource))
        // configurable filter
        .filter(satisfiesFilter);

    const selectMethod = solveMethods[conceptCfg.selectMethod] || selectUnusedConcept;
    return selectMethod({ concepts: filteredConcepts, dataConfig, usedConcepts, space }).concept
        || undefined;
}

function mostCommonDimensionProperty(space, dataConfig, usedConcepts) {
    const dataSource = dataConfig.source;
    const availability = dataSource.availability;
    const entitySpace = space.filter(dim => dataSource.isEntityConcept(dim));
    const candidates = [];
    for (let dim of entitySpace) {
        const concepts = availability.keyValueLookup.get(createKeyStr([dim])).keys();
        candidates.push(...concepts);
    }
    return mode(candidates);
}


function selectUnusedConcept({ concepts, usedConcepts }) {
    // first try unused concepts, otherwise, use already used concept
    return concepts.find(concept => !usedConcepts.includes(concept.concept)) || concepts[0];
}

function needsSpaceAutoCfg(dataConfig) {
    const cfg = dataConfig.config;
    const defaults = dataConfig.defaults;
    const isMarkerOrStandaloneDataConfig = !dataConfig.hasEncodingMarker;
    const usesDefaultAutoConfig = !cfg.space && needsSolving(defaults.space);
    return needsSolving(cfg.space) 
        || (isMarkerOrStandaloneDataConfig && usesDefaultAutoConfig);
}

function needsConceptAutoCfg(dataConfig) {
    const cfg = dataConfig.config;
    const defaults = dataConfig.defaults;
    const isStandAloneDataConfig = !dataConfig.marker;
    const isNotMarkerDataConfig = dataConfig.hasEncodingMarker;
    const usesDefaultSolving = !("concept" in cfg) && needsSolving(defaults.concept);
    return !isReference(dataConfig.config.concept) && (needsSolving(cfg.concept)
        || ((isNotMarkerDataConfig || isStandAloneDataConfig) && usesDefaultSolving));
}

function needsAutoConfig(dataConfig) {
    return needsSpaceAutoCfg(dataConfig) || needsConceptAutoCfg(dataConfig);
}

function dataConfigPromisesBeforeSolving(dataConfig) {
    if (needsAutoConfig(dataConfig))
        return [dataConfig.source.metaDataPromise];
    else 
        return [];
}

function markerPromiseBeforeSolving(marker) {
    const dataConfigs = [marker.data];
    for (const enc of Object.values(marker.encoding)) { dataConfigs.push(enc.data) };
    const promises = dataConfigs.flatMap(dataConfigPromisesBeforeSolving);
    const uniquePromises = [...new Set(promises)];
    return fromPromiseAll(uniquePromises);
}
