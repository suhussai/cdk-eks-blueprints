import { ClusterAddOn, ClusterInfo, Values } from "../../spi";
import { dependable, loadYaml, readYamlDocument } from "../../utils";
import { AdotCollectorAddOn } from "../adot";
import { Construct } from 'constructs';
import { KubectlProvider, ManifestDeployment } from "../helm-addon/kubectl-provider";

/**
 * This CloudWatch ADOT Addon deploys an AWS Distro for OpenTelemetry (ADOT) Collector for 
 * CloudWatch which receives metrics and logs from the application and sends the same to 
 * CloudWatch console. You can change the mode to Daemonset, StatefulSet, and Sidecar 
 * depending on your deployment strategy.
 */

/**
 * Configuration options for add-on.
 */
export interface CloudWatchAdotAddOnProps {
    /**
     * Modes supported : `deployment`, `daemonset`, `statefulSet`, and `sidecar`
     * @default deployment
     */
    deploymentMode?: cloudWatchDeploymentMode;
    /**
     * Namespace to deploy the ADOT Collector for CloudWatch.
     * @default default
     */
    namespace?: string;
    /**
     * Name to deploy the ADOT Collector for CloudWatch.
     * @default 'adot-collector-cloudwatch'
     */
     name?: string;
}

export const enum cloudWatchDeploymentMode {
    DEPLOYMENT = 'deployment',
    DAEMONSET = 'daemonset',
    STATEFULSET = 'statefulset',
    SIDECAR = 'sidecar'
}

/**
 * Defaults options for the add-on
 */
const defaultProps = {
    deploymentMode: cloudWatchDeploymentMode.DEPLOYMENT,
    namespace: 'default',
    name: 'adot-collector-cloudwatch'
};

/**
 * Implementation of CloudWatch ADOT add-on for EKS Blueprints. Installs ADOT Collector.
 */
export class CloudWatchAdotAddOn implements ClusterAddOn {

    readonly cloudWatchAddOnProps: CloudWatchAdotAddOnProps;

    constructor(props?: CloudWatchAdotAddOnProps) {
        this.cloudWatchAddOnProps = { ...defaultProps, ...props };
    }

    @dependable(AdotCollectorAddOn.name)
    deploy(clusterInfo: ClusterInfo): Promise<Construct> {
        const cluster = clusterInfo.cluster;

        // Applying manifest for configuring ADOT Collector for CloudWatch.
        const doc = readYamlDocument(__dirname +'/collector-config-cloudwatch.ytpl');
        const manifest = doc.split("---").map(e => loadYaml(e));
        const values: Values = {
            awsRegion: cluster.stack.region,
            deploymentMode: this.cloudWatchAddOnProps.deploymentMode,
            namespace: this.cloudWatchAddOnProps.namespace,
            clusterName: cluster.clusterName
         };
         
         const manifestDeployment: ManifestDeployment = {
            name: this.cloudWatchAddOnProps.name!,
            namespace: this.cloudWatchAddOnProps.namespace!,
            manifest,
            values
        };

        const kubectlProvider = new KubectlProvider(clusterInfo);
        const statement = kubectlProvider.addManifest(manifestDeployment);
        return Promise.resolve(statement);
    }
}