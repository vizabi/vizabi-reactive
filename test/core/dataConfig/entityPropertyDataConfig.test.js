import { entityPropertyDataConfig } from '../../../src/core/dataConfig/entityPropertyDataConfig';
import { dataSourceStore } from '../../../src/core/dataSource/dataSourceStore';
import { _resetGlobalState, configure, autorun } from 'mobx';
import * as DDFCsvReader from 'vizabi-ddfcsv-reader';

function check(model, prop) {
    return new Promise((resolve, reject) => {
        autorun(() => {
            if (model.state == 'fulfilled') {
                resolve(model[prop]);
            }
        });
    });
}

describe('create stand alone data configs', () => {
    it('create a new dataConfig and get response', () => {
        const DDFReadObject = DDFCsvReader.getDDFCsvReaderObject();
        dataSourceStore.createAndAddType('ddf', DDFReadObject);
        const data = entityPropertyDataConfig({
            source: { 
                path: 'test/ddf--jheeffer--mdtest',
                modelType: 'ddf'
            },
            concept: 'name',
            space: ['geo', 'gender', 'time']
        })
        return check(data, 'responseMap').then(response => expect(response.get({geo: 'swe'}).name.geo).toBe('Sweden'));
    })

})