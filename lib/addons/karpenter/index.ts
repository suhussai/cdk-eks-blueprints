import { Construct } from '@aws-cdk/core';
import { Role, ManagedPolicy, ServicePrincipal, CfnInstanceProfile, PolicyDocument } from '@aws-cdk/aws-iam';
import { ClusterInfo } from '../../spi';
import { HelmAddOn, HelmAddOnProps, HelmAddOnUserProps } from '../helm-addon';
import { createNamespace, setPath, createServiceAccount, convertToSpec, conflictsWith } from '../../utils'
import { KarpenterControllerPolicy } from './iam'

/**
 * Configuration options for the add-on
 */
interface KarpenterAddOnProps extends HelmAddOnUserProps {
    /**
     * Specs for Default Provisional (Optional)
     */
     defaultProvisionerSpecs?: { [key: string]: string[]; }
}

const KARPENTER = 'karpenter'

const defaultProps: HelmAddOnProps = {
    name: KARPENTER,
    namespace: KARPENTER,
    version: '0.5.3',
    chart: KARPENTER,
    release: "ssp-addon-karpenter",
    repository: 'https://charts.karpenter.sh',
}

export class KarpenterAddOn extends HelmAddOn {

    readonly options: KarpenterAddOnProps;

    constructor(props?: KarpenterAddOnProps) {
        super({...defaultProps, ...props});
        this.options = this.props;
    }

    @conflictsWith('ClusterAutoScalerAddOn')
    deploy(clusterInfo: ClusterInfo): Promise<Construct> {
        const endpoint = clusterInfo.cluster.clusterEndpoint
        const name = clusterInfo.cluster.clusterName
        const cluster = clusterInfo.cluster
        const values = { ...this.props.values ?? {} }

        // Set up Node Role
        const karpenterNodeRole = new Role(cluster, 'karpenter-node-role', {
            assumedBy: new ServicePrincipal(`ec2.${cluster.stack.urlSuffix}`),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"),
                ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy"),
                ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
                ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
            ],
            roleName: `KarpenterNodeRole-${name}`
        });

        // Set up Instance Profile
        const karpenterInstanceProfile = new CfnInstanceProfile(cluster, 'karpenter-instance-profile', {
            roles: [karpenterNodeRole.roleName],
            instanceProfileName: `KarpenterNodeInstanceProfile-${name}`,
            path: '/'
        });

        // Map Node Role to aws-auth
        cluster.awsAuth.addRoleMapping(karpenterNodeRole, {
            groups: ['system:bootstrapper', 'system:nodes'],
            username: 'system:node:{{EC2PrivateDNSName}}'
        })

        // Create Namespace & SA
        const ns = createNamespace(KARPENTER, cluster)
        const karpenterPolicyDocument = PolicyDocument.fromJson(KarpenterControllerPolicy);
        const sa = createServiceAccount(cluster, KARPENTER, KARPENTER, karpenterPolicyDocument)
        sa.node.addDependency(ns)

        // Add helm chart
        setPath(values, "serviceAccount.create", false)
        setPath(values, "controller.clusterEndpoint", endpoint)
        setPath(values, "controller.clusterName", name)
        const karpenterChart = this.addHelmChart(clusterInfo, values, true)

        karpenterChart.node.addDependency(sa);

        // (Optional) default provisioner - defaults to 30 seconds for scale down for
        // low utilization
        if (this.options.defaultProvisionerSpecs){
            const provisioner = cluster.addManifest('default-provisioner', {
                apiVersion: 'karpenter.sh/v1alpha5',
                kind: 'Provisioner',
                metadata: { name: 'default' },
                spec: {
                    requirements: convertToSpec(this.options.defaultProvisionerSpecs),
                    provider: {
                        instanceProfile: `${karpenterInstanceProfile}`
                    },
                    ttlSecondsAfterEmpty: 30
                }
            })
            provisioner.node.addDependency(karpenterChart)
        }

        return Promise.resolve(karpenterChart);
    }
}