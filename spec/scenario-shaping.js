// Scenario-shaping helpers shared by the reference and implementation
// runners. They are pure object surgery and deliberately import nothing:
// the implementation runner must be able to shape scenarios without
// touching the module scope of run-adapter-vectors.js, which imports the
// oracle under names identical to the engine's (Plan 1 handoff, carry 2).

export function mutateObject(target, scenario) {
  if (scenario.delete) {
    const segments = scenario.delete.split('.');
    const parent = segments.slice(0, -1).reduce((value, key) => value[key], target);
    delete parent[segments.at(-1)];
  }
  for (const mutation of [...(scenario.sets ?? []), ...(scenario.set ? [scenario.set] : [])]) {
    const segments = mutation.path.split('.');
    const parent = segments.slice(0, -1).reduce((value, key) => value[key], target);
    parent[segments.at(-1)] = mutation.value;
  }
}

export function applyCapabilityInvariantScenario(dynamic, scenario) {
  const command = dynamic.host.command_execution;
  const filesystem = dynamic.host.filesystem;
  const instruction = dynamic.host.instruction_input;
  const dependentCommandMembers = [
    'arguments_array',
    'stdio',
    'process_tree_containment',
    'orphan_detection',
    'timeout_enforcement',
    'stdout_limit',
    'stderr_limit',
  ];
  switch (scenario.mode) {
    case 'supported':
      command[scenario.member] = scenario.value;
      return;
    case 'limit':
      dynamic.limits[scenario.member] = 0;
      return;
    case 'guarded':
      filesystem[scenario.member] = false;
      return;
    case 'unsupported':
    case 'unsupported-invoke':
      command.supported = false;
      command.shell = false;
      for (const member of dependentCommandMembers) command[member] = false;
      dynamic.core.commands = [];
      if (scenario.mode === 'unsupported') command[scenario.member] = true;
      else dynamic.core.commands = ['capabilities'];
      return;
    case 'filesystem-none':
      filesystem.workspace_selection = 'none';
      filesystem.no_follow_resolution = false;
      filesystem.stable_identity = false;
      filesystem.component_walk = false;
      filesystem[scenario.member] = true;
      return;
    case 'instruction-none':
      instruction.mode = 'none';
      instruction.max_sources = 0;
      instruction.max_bytes = 0;
      instruction[scenario.member] = 1;
      return;
    case 'instruction-configured':
      instruction[scenario.member] = 0;
      return;
    default:
      throw new Error(`unknown capability invariant mode: ${scenario.mode}`);
  }
}
