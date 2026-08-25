// Dynamic Expo config. Everything still lives in app.json — this file only
// overrides one field: where google-services.json comes from.
//
// WHY: google-services.json is the Firebase/FCM client config. In a PUBLIC repo
// we don't commit it. Instead it's stored as an encrypted EAS "file" variable
// (GOOGLE_SERVICES_JSON), which EAS materialises to a path during the build and
// exposes via process.env. Locally (where the env var is absent) we fall back to
// the on-disk ./google-services.json (gitignored). So both local and CI builds
// get the file, and nothing sensitive ever touches git.
export default ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
  },
});
