/// <reference path="../pb_data/types.d.ts" />

// Denormalize the completed review's risk score onto review_jobs so list
// surfaces can show it without fetching the full review content JSON.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('review_jobs');

    collection.fields.add(
      new Field({
        name: 'risk_score',
        type: 'number',
        onlyInt: true,
        min: 1,
        max: 5,
      }),
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('review_jobs');
    collection.fields.removeByName('risk_score');
    return app.save(collection);
  },
);
