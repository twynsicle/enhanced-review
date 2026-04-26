/// <reference path="../pb_data/types.d.ts" />

// Add `github_login` to the users collection. The PB GitHub OAuth provider
// auto-fills `username` with a random `users<hash>` slug — the actual GitHub
// username lives in the OAuth `meta.username` returned by authWithOAuth2,
// which we persist here via the `/api/auth/post-signin` route after the
// browser OAuth handshake completes.
//
// `allowed_users` keys on this value, so without it the middleware allowlist
// gate would have nothing to compare against. Optional in PB (auth records
// are created before we know the value); the app code treats its absence as
// "denied".

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('_pb_users_auth_');

    collection.fields.add(
      new Field({
        name: 'github_login',
        type: 'text',
        max: 100,
      }),
    );

    collection.indexes = [
      ...(collection.indexes || []),
      'CREATE UNIQUE INDEX `idx_users_github_login` ON `users` (`github_login`) WHERE `github_login` != \'\'',
    ];

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('_pb_users_auth_');
    collection.fields.removeByName('github_login');
    collection.indexes = (collection.indexes || []).filter(
      (idx) => !idx.includes('idx_users_github_login'),
    );
    return app.save(collection);
  },
);
