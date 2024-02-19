const debug = require("debug");

// Jest swallows stderr from debug, so if process is called with DEBUG then redirect debug to console.log
if (process.env.DEBUG) {
  /* eslint-disable no-console */
  debug.log = console.log.bind(console);
}

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    axios: "axios/dist/node/axios.cjs", // Temporary workaround: Force Jest to import the CommonJS Axios build
  },
};
