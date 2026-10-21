import {
  NodeConnectionTypes,
  type INodeType,
  type INodeTypeDescription,
} from "n8n-workflow";
import { nodeProperties } from "./properties";
import { execute } from "./execute";
import { credentialName, credentialTest } from "../../shared/client/client";

export class ClinicaWeb implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Clinica Web",
    name: "clinicaWeb",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: "Use Clinica Web static data, public, ERP and webhook APIs",
    defaults: { name: "Clinica Web" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: credentialName,
        required: true,
        testedBy: "clinicaWebCredentialTest",
      },
    ],
    properties: nodeProperties(),
  };
  methods = { credentialTest: { clinicaWebCredentialTest: credentialTest } };
  execute = execute;
}
