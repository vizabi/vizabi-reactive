import { resolveRef } from "../config";
import { dataSourceStore } from "../dataSource/dataSourceStore";
import { trace, observable } from "mobx";
import { applyDefaults, arrayEquals, fromPromiseAll, intersect, isNonNullObject, isNumeric } from "../utils";
import { filter } from "../filter";
import { DataFrame } from "../../dataframe/dataFrame";
import { createFilterFn } from "../../dataframe/transforms/filter";
import { fromPromise, FULFILLED } from "mobx-utils";
import { extent } from "../../dataframe/info/extent";
import { unique } from "../../dataframe/info/unique";
import { createKeyStr, isDataFrame } from "../../dataframe/dfutils";
import { configSolver } from "./configSolver";

const defaultConfig = {
}

export function dataConfig(config = {}, parent) {
    return observable(
        dataConfig.nonObservable(observable(config), parent),
        { config: observable.ref }, 
    );
}

dataConfig.nonObservable = function(config, parent) {

    applyDefaults(config, defaultConfig);
    let latestResponse = [];

    return {
        defaults: {
            filter: null,
            constant: null,
            concept: { filter: { concept_type: "measure" } },
            space: { /* solve from data */ },
            value: null,
            locale: null,
            source: null,
            domain: [0, 1],
            domainDataSource: 'auto'
        },
        config,
        parent,
        get hasEncodingMarker() {
            return this.parent && this.parent.marker;
        },
        get invariants() {
            let fails = [];
            if (this.constant && (this.concept || this.source)) fails.push("Can't have constant value and concept or source set.");
            if (this.conceptInSpace && this.source) fails.push("Can't have concept in space and have a source simultaneously");
            if (fails.length > 0)
                console.warn("One or more invariants not satisfied:",fails,this);
        },
        get source() {
            const source = resolveRef(this.config.source);
            if (source)
                return dataSourceStore.get(source, this)
            else {
                if (this.hasEncodingMarker)
                    return this.parent.marker.data.source;
                else
                    return null;
            }
        },
        get space() {
            return this.configSolution.space;
        },
        get constant() {
            return resolveRef(this.config.constant) || this.defaults.constant;
        },
        isConstant() {
            return this.constant != null;
        },
        get commonSpace() {
            if (this.hasEncodingMarker)
                return intersect(this.space, this.parent.marker.data.space);
            else if (!this.marker) // dataConfig used on its own
                return this.space;
            console.warn('Cannot get data.commonSpace of Marker.data. Only meaningful on Encoding.data.')
        },
        get filter() {
            const config = this.config.filter || (this.hasEncodingMarker ? this.parent.marker.data.config.filter : {});
            return filter(config, this);
        },
        get locale() {
            if (this.config.locale)
                return typeof this.config.locale == "string" ? this.config.locale : this.config.locale.id;
            else
                return this.hasEncodingMarker ? this.parent.marker.data.locale || this.source.locale : this.source.locale;              
        },
        get concept() { 
            return this.configSolution.concept;
        },
        get conceptProps() { return this.concept && this.source.getConcept(this.concept) },
        get availability() { return this.source.availability.data.map(kv => this.source.getConcept(kv.value)) },
        get domainDataSource() {
            let source = this.config.domainDataSource || this.defaults.domainDataSource;
            if (source === 'auto') {
                source = this.conceptInSpace
                    ? 'filterRequired'
                    : 'self';
            }
            return source;
        },
        get domainData() {
            const source = this.domainDataSource;
            const data = source === 'self' ? this.responseMap
                : this.hasEncodingMarker && this.parent.marker.transformedDataMaps.has(source) ? this.parent.marker.transformedDataMaps.get(source).get()
                : source === 'markers' ? this.parent.marker.dataMap  
                : this.responseMap;

            return data;
        },
        get domain() {
            //trace();
            if (this.isConstant())
                return isNumeric(this.constant) ? [this.constant, this.constant] : [this.constant];

            return this.calcDomain(this.domainData, this.conceptProps);
        },
        calcDomain(data, { concept, concept_type }) { 
            // use rows api implemented by both group and df
            if (["measure","time"].includes(concept_type)) // continuous
                return extent(data.rows(), concept);
            else // ordinal (entity_set, entity_domain, string)
                return unique(data.rows(), concept); 
        },

        get marker() {
            if (this.hasEncodingMarker) {
                return this.parent.marker;
            }
            if (this.parent) {
                if (this.parent.marker) {
                    return this.parent.marker;
                }
                if (this.parent.encoding) {
                    return this.parent
                }
            }
            return undefined;
        },
        get configSolution() {
            return configSolver.configSolution(this);
        },
        get hasOwnData() {
            return this.source && this.concept && !this.conceptInSpace;
        },
        sendQuery() {
            if (!this.source || !this.concept) {
                console.warn("Encoding " + this.parent.name + " was asked for data but source and/or concept is not set.");
                return fromPromise.resolve();
            } else if (this.conceptInSpace) {         
                //console.warn("Encoding " + this.parent.name + " was asked for data but concept is in space.", { space: this.space, concept: this.concept }); 
                return fromPromise.resolve(); 
            } else {
                return this.source.query(this.ddfQuery);
            }
        },
        get promise() {
            if (this.isConstant()) { return fromPromise.resolve() }

            const sourcePromises = configSolver.dataConfigPromisesBeforeSolving(this);
            if (this.source) { sourcePromises.push(this.source.conceptsPromise) } // conceptPromise needed for calcDomain()
            const combined = fromPromiseAll(sourcePromises);
            return combined.case({ 
                fulfilled: () => this.hasOwnData ? this.sendQuery() : fromPromise.resolve(),
                pending: () => combined,
            })
        },
        get state() {
            return this.promise.state;
        },
        get response() {
            //trace();
            if (this.isConstant()) {
                throw(new Error(`Can't get response for dataConfig with constant value.`))
            }
            return this.promise.case({
                pending: () => latestResponse,
                rejected: e => latestResponse,
                fulfilled: (res) => latestResponse = res
            });
        },
        get responseMap() {
            //trace();
            //response.key is not equal to space when we read csv file and response.key is empty
            if (isDataFrame(this.response) && arrayEquals(this.response.key, this.space))
                return this.response;
            else 
                return DataFrame(this.response, this.commonSpace);            
        },
        get conceptInSpace() {
            return this.concept && this.space && this.space.includes(this.concept);
        },
        get ddfQuery() {
            const query = {};
            // select
            query.select = {
                key: this.space.slice(), // slice to make sure it's a normal array (not mobx)
                value: [this.concept]
            }

            // from
            query.from = (this.space.length === 1) ? "entities" : "datapoints";

            // where
            if (this.filter) {
                query.where = this.filter.whereClause(query.select.key);
            }
          
            if (this.locale) {
                query.language = this.locale; 
            }
          
            return query;
        },
        destruct() { }
    };
}
