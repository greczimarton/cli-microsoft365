import { AppRole, AppRoleAssignment, ServicePrincipal } from '@microsoft/microsoft-graph-types';
import { Logger } from '../../../../cli/Logger.js';
import GlobalOptions from '../../../../GlobalOptions.js';
import request, { CliRequestOptions } from '../../../../request.js';
import { formatting } from '../../../../utils/formatting.js';
import { validation } from '../../../../utils/validation.js';
import GraphCommand from '../../../base/GraphCommand.js';
import commands from '../../commands.js';
import aadCommands from '../../aadCommands.js';

interface CommandArgs {
  options: Options;
}

interface Options extends GlobalOptions {
  appId?: string;
  appDisplayName?: string;
  appObjectId?: string;
}

class EntraAppRoleAssignmentListCommand extends GraphCommand {
  public get name(): string {
    return commands.APPROLEASSIGNMENT_LIST;
  }

  public get description(): string {
    return 'Lists app role assignments for the specified application registration';
  }

  public alias(): string[] | undefined {
    return [aadCommands.APPROLEASSIGNMENT_LIST];
  }

  constructor() {
    super();

    this.#initTelemetry();
    this.#initOptions();
    this.#initValidators();
    this.#initOptionSets();
  }

  #initTelemetry(): void {
    this.telemetry.push((args: CommandArgs) => {
      Object.assign(this.telemetryProperties, {
        appId: typeof args.options.appId !== 'undefined',
        appDisplayName: typeof args.options.appDisplayName !== 'undefined',
        appObjectId: typeof args.options.appObjectId !== 'undefined'
      });
    });
  }

  #initOptions(): void {
    this.options.unshift(
      {
        option: '-i, --appId [appId]'
      },
      {
        option: '-n, --appDisplayName [appDisplayName]'
      },
      {
        option: '--appObjectId [appObjectId]'
      }
    );
  }

  #initValidators(): void {
    this.validators.push(
      async (args: CommandArgs) => {
        if (args.options.appId && !validation.isValidGuid(args.options.appId)) {
          return `${args.options.appId} is not a valid GUID`;
        }

        if (args.options.appObjectId && !validation.isValidGuid(args.options.appObjectId)) {
          return `${args.options.appObjectId} is not a valid GUID`;
        }

        return true;
      }
    );
  }

  #initOptionSets(): void {
    this.optionSets.push({ options: ['appId', 'appObjectId', 'appDisplayName'] });
  }

  public defaultProperties(): string[] | undefined {
    return ['resourceDisplayName', 'roleName'];
  }

  public async commandAction(logger: Logger, args: CommandArgs): Promise<void> {
    try {
      const spAppRoleAssignments = await this.getAppRoleAssignments(args.options);
      // the role assignment has an appRoleId but no name. To get the name,
      // we need to get all the roles from the resource. the resource is
      // a service principal. Multiple roles may have same resource id.
      const resourceIds = spAppRoleAssignments.map((item: AppRoleAssignment) => item.resourceId);

      const tasks: Promise<ServicePrincipal>[] = [];
      for (let i: number = 0; i < resourceIds.length; i++) {
        tasks.push(this.getServicePrincipal(resourceIds[i]!));
      }

      const resources = await Promise.all(tasks);

      // loop through all appRoleAssignments for the servicePrincipal
      // and lookup the appRole.Id in the resources[resourceId].appRoles array...
      const results: any[] = [];
      spAppRoleAssignments.map((appRoleAssignment: AppRoleAssignment) => {
        const resource: ServicePrincipal | undefined = resources.find((r: any) => r.id === appRoleAssignment.resourceId);

        if (resource) {
          const appRole: AppRole | undefined = resource.appRoles!.find((r: any) => r.id === appRoleAssignment.appRoleId);

          if (appRole) {
            results.push({
              appRoleId: appRoleAssignment.appRoleId,
              resourceDisplayName: appRoleAssignment.resourceDisplayName,
              resourceId: appRoleAssignment.resourceId,
              roleId: appRole.id,
              roleName: appRole.value,
              created: appRoleAssignment.createdDateTime,
              deleted: appRoleAssignment.deletedDateTime
            });
          }
        }
      });

      await logger.log(results);
    }
    catch (err: any) {
      this.handleRejectedODataJsonPromise(err);
    }
  }

  private async getAppRoleAssignments(argOptions: Options): Promise<AppRoleAssignment[]> {
    if (argOptions.appObjectId) {
      const spAppRoleAssignments = await this.getSPAppRoleAssignments(argOptions.appObjectId);

      if (!spAppRoleAssignments.value.length) {
        throw 'no app role assignments found';
      }

      return spAppRoleAssignments.value;
    }
    else {
      const spMatchQuery: string = argOptions.appId
        ? `appId eq '${formatting.encodeQueryParameter(argOptions.appId)}'`
        : `displayName eq '${formatting.encodeQueryParameter(argOptions.appDisplayName as string)}'`;

      const resp = await this.getServicePrincipalForApp(spMatchQuery);
      if (!resp.value.length) {
        throw 'app registration not found';
      }

      return resp.value[0].appRoleAssignments!;
    }
  }

  private async getSPAppRoleAssignments(spId: string): Promise<{ value: AppRoleAssignment[] }> {
    const spRequestOptions: CliRequestOptions = {
      url: `${this.resource}/v1.0/servicePrincipals/${spId}/appRoleAssignments`,
      headers: {
        accept: 'application/json'
      },
      responseType: 'json'
    };

    return request.get<{ value: AppRoleAssignment[] }>(spRequestOptions);
  }

  private async getServicePrincipalForApp(filterParam: string): Promise<{ value: ServicePrincipal[] }> {
    const spRequestOptions: CliRequestOptions = {
      url: `${this.resource}/v1.0/servicePrincipals?$expand=appRoleAssignments&$filter=${filterParam}`,
      headers: {
        accept: 'application/json'
      },
      responseType: 'json'
    };

    return request.get<{ value: ServicePrincipal[] }>(spRequestOptions);
  }

  private async getServicePrincipal(spId: string): Promise<ServicePrincipal> {
    const spRequestOptions: CliRequestOptions = {
      url: `${this.resource}/v1.0/servicePrincipals/${spId}`,
      headers: {
        accept: 'application/json'
      },
      responseType: 'json'
    };

    return request.get<ServicePrincipal>(spRequestOptions);
  }
}

export default new EntraAppRoleAssignmentListCommand();