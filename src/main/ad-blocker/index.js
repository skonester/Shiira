/**
 * Shiira Browser Ad-Blocker Module
 * Main entry point for ad-blocking functionality
 */

const { getAdBlocker, RequestHandler } = require('./request-handler');
const { RuleLoader } = require('./rule-loader');
const { RuleEngine } = require('./rule-engine');
const { CosmeticEngine } = require('./cosmetic-engine');
const { CosmeticInjector, getCosmeticInjector } = require('./cosmetic-injector');
const { ScriptInjector, getScriptInjector } = require('./script-injector');

module.exports = {
  // Network blocking
  getAdBlocker,
  RequestHandler,
  RuleLoader,
  RuleEngine,
  // Cosmetic filtering
  CosmeticEngine,
  CosmeticInjector,
  getCosmeticInjector,
  // Script injection
  ScriptInjector,
  getScriptInjector
};
