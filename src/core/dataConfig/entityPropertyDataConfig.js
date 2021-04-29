import { dataConfig } from './dataConfig';
import { composeObj, renameProperty } from '../utils';
import { trace, toJS, observable } from 'mobx';
import { fromPromise } from 'mobx-utils';
import { DataFrame } from '../../dataframe/dataFrame';
import { configSolver } from './configSolver';

export function entityPropertyDataConfig(config, parent) {
    return observable(
        entityPropertyDataConfig.nonObservable(observable(config), parent), {
        config: observable.ref
    });
}

entityPropertyDataConfig.nonObservable = function (cfg, parent) {

    if (!("concept" in cfg)) cfg.concept = { 
        solveMethod: 'mostCommonDimensionProperty', 
        allowedProperties: ['name', 'title']
    }

    const base = dataConfig.nonObservable(cfg, parent);

    return composeObj(base, {

        sendQuery() {
            const labelPromises = this.queries.map(query => this.source.query(query)
                .then(data => ({ dim: query.select.key[0], data }))
            );
            return fromPromise(Promise.all(labelPromises));
        },
        get queries() {
            const entityDims = this.space.filter(dim => this.source.isEntityConcept(dim));
            const kvLookup = this.source.availability.keyValueLookup;
            return entityDims
                .filter(dim => kvLookup.get(dim).has(this.concept))
                .map(dim => {
                    const { concept, filter, locale } = this;
                    return this.createQuery({ concept, space: [dim], filter, locale });
                });
        },
        lookups(response, concept) {
            const lookups = new Map();
            response.forEach(dimResponse => {
                const { dim, data } = dimResponse;
                const lookup = new Map();
                lookups.set(dim, lookup);
                data.forEach(row => {
                    lookup.set(row[dim], row[concept]);
                })
            });
            return new Map([[concept, lookups]]);
        },
        get response() {
            const response = this.promise.value;
            const lookups = this.lookups(response, this.concept);
            return DataFrame.fromLookups(lookups, this.commonSpace)
        }
    })
}