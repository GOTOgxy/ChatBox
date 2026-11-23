const registry = new Map();

function register(mechanism) {
  if (!mechanism || !mechanism.id || typeof mechanism.run !== 'function') {
    throw new Error('mechanism must have id and run()');
  }
  registry.set(mechanism.id, mechanism);
}

function get(id) {
  return registry.get(id);
}

function list() {
  return Array.from(registry.values()).map(({ id, name, description }) => ({ id, name, description }));
}

async function run(id, context) {
  const mechanism = registry.get(id);
  if (!mechanism) return { ok: false, error: `unknown mechanism: ${id}` };
  return mechanism.run(context);
}

module.exports = { register, get, list, run };
