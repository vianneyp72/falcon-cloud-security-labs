// Import all lab markdown files explicitly using the @content alias (resolves to repo root)
import k8sStandard from '@content/kubernetes/helm-daemonset/k8s-standard/lab.md?raw'
import k8sEksHybrid from '@content/kubernetes/helm-daemonset/eks-hybrid/lab.md?raw'
import k8sGkeAutopilot from '@content/kubernetes/helm-daemonset/gke-autopilot/lab.md?raw'
import k8sSidecarAny from '@content/kubernetes/helm-sidecar/any-cluster/lab.md?raw'
import k8sSidecarFargate from '@content/kubernetes/helm-sidecar/eks-fargate/lab.md?raw'
import k8sSidecarAks from '@content/kubernetes/helm-sidecar/aks-virtual-nodes/lab.md?raw'
import k8sOpGeneric from '@content/kubernetes/operator/generic/lab.md?raw'
import k8sOpOpenshift from '@content/kubernetes/operator/openshift/lab.md?raw'
import k8sOpTainted from '@content/kubernetes/operator/tainted-nodes/lab.md?raw'
import ecsFargatePatch from '@content/ecs/fargate-task-patching/lab.md?raw'
import ecsFargateUtility from '@content/ecs/fargate-falcon-utility/lab.md?raw'
import ecsEc2Daemon from '@content/ecs/ec2-daemon-service/lab.md?raw'
import vmLinuxAnsible from '@content/vms/linux/ansible/lab.md?raw'
import vmLinuxGce from '@content/vms/linux/gce-startup-script/lab.md?raw'
import vmLinuxTerraform from '@content/vms/linux/terraform-userdata/lab.md?raw'
import vmLinuxPacker from '@content/vms/linux/packer-ami/lab.md?raw'
import vmLinuxChef from '@content/vms/linux/chef/lab.md?raw'
import vmLinuxPuppet from '@content/vms/linux/puppet/lab.md?raw'
import vmLinuxSsm from '@content/vms/linux/aws-ssm/lab.md?raw'
import vmLinuxManual from '@content/vms/linux/manual-cli/lab.md?raw'
import vmWinGpo from '@content/vms/windows/gpo/lab.md?raw'
import vmWinIntune from '@content/vms/windows/intune/lab.md?raw'
import vmWinSccm from '@content/vms/windows/sccm/lab.md?raw'
import vmWinPacker from '@content/vms/windows/packer-ami/lab.md?raw'
import vmWinSsm from '@content/vms/windows/aws-ssm/lab.md?raw'
import vmWinManual from '@content/vms/windows/manual-cli/lab.md?raw'
import cipDocker from '@content/container-image-patching/local-docker/lab.md?raw'
import cipGithub from '@content/container-image-patching/github-actions/lab.md?raw'
import cipGitlab from '@content/container-image-patching/gitlab-ci/lab.md?raw'
import cipJenkins from '@content/container-image-patching/jenkins/lab.md?raw'
import scAzureApps from '@content/serverless-containers/azure-container-apps/lab.md?raw'
import scAzureInstances from '@content/serverless-containers/azure-container-instances/lab.md?raw'
import scCloudRun from '@content/serverless-containers/cloud-run/lab.md?raw'
import fcsGithubActions from '@content/fcs-cli/github-actions-image-scan/lab.md?raw'
import commonApiCreds from '@content/_common/api-credentials.md?raw'
import commonPullImages from '@content/_common/pull-sensor-images.md?raw'
import commonVerification from '@content/_common/verification.md?raw'

// Overview READMEs
import overviewK8s from '@content/kubernetes/README.md?raw'
import overviewEcs from '@content/ecs/README.md?raw'
import overviewVms from '@content/vms/README.md?raw'
import overviewCip from '@content/container-image-patching/README.md?raw'
import overviewSc from '@content/serverless-containers/README.md?raw'

// Map paths to content
const labs = {
  'kubernetes/helm-daemonset/k8s-standard/lab.md': k8sStandard,
  'kubernetes/helm-daemonset/eks-hybrid/lab.md': k8sEksHybrid,
  'kubernetes/helm-daemonset/gke-autopilot/lab.md': k8sGkeAutopilot,
  'kubernetes/helm-sidecar/any-cluster/lab.md': k8sSidecarAny,
  'kubernetes/helm-sidecar/eks-fargate/lab.md': k8sSidecarFargate,
  'kubernetes/helm-sidecar/aks-virtual-nodes/lab.md': k8sSidecarAks,
  'kubernetes/operator/generic/lab.md': k8sOpGeneric,
  'kubernetes/operator/openshift/lab.md': k8sOpOpenshift,
  'kubernetes/operator/tainted-nodes/lab.md': k8sOpTainted,
  'ecs/fargate-task-patching/lab.md': ecsFargatePatch,
  'ecs/fargate-falcon-utility/lab.md': ecsFargateUtility,
  'ecs/ec2-daemon-service/lab.md': ecsEc2Daemon,
  'vms/linux/ansible/lab.md': vmLinuxAnsible,
  'vms/linux/gce-startup-script/lab.md': vmLinuxGce,
  'vms/linux/terraform-userdata/lab.md': vmLinuxTerraform,
  'vms/linux/packer-ami/lab.md': vmLinuxPacker,
  'vms/linux/chef/lab.md': vmLinuxChef,
  'vms/linux/puppet/lab.md': vmLinuxPuppet,
  'vms/linux/aws-ssm/lab.md': vmLinuxSsm,
  'vms/linux/manual-cli/lab.md': vmLinuxManual,
  'vms/windows/gpo/lab.md': vmWinGpo,
  'vms/windows/intune/lab.md': vmWinIntune,
  'vms/windows/sccm/lab.md': vmWinSccm,
  'vms/windows/packer-ami/lab.md': vmWinPacker,
  'vms/windows/aws-ssm/lab.md': vmWinSsm,
  'vms/windows/manual-cli/lab.md': vmWinManual,
  'container-image-patching/local-docker/lab.md': cipDocker,
  'container-image-patching/github-actions/lab.md': cipGithub,
  'container-image-patching/gitlab-ci/lab.md': cipGitlab,
  'container-image-patching/jenkins/lab.md': cipJenkins,
  'serverless-containers/azure-container-apps/lab.md': scAzureApps,
  'serverless-containers/azure-container-instances/lab.md': scAzureInstances,
  'serverless-containers/cloud-run/lab.md': scCloudRun,
  'fcs-cli/github-actions-image-scan/lab.md': fcsGithubActions,
  '_common/api-credentials.md': commonApiCreds,
  '_common/pull-sensor-images.md': commonPullImages,
  '_common/verification.md': commonVerification,
}

const overviews = {
  'kubernetes/README.md': overviewK8s,
  'ecs/README.md': overviewEcs,
  'vms/README.md': overviewVms,
  'container-image-patching/README.md': overviewCip,
  'serverless-containers/README.md': overviewSc,
}

function getStatus(content) {
  if (!content || content.trim().length === 0) return 'empty'
  if (content.includes('> **Status:**') || content.includes('Steps not yet written')) return 'stub'
  return 'complete'
}

function desc(content) {
  if (!content) return ''
  const lines = content.split('\n').filter(l => l.trim())
  for (let i = 1; i < lines.length && i < 5; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('#') && !line.startsWith('>') && !line.startsWith('Official')) {
      return line.slice(0, 120)
    }
  }
  return ''
}

function lab(label, route, mdPath) {
  const content = labs[mdPath] || ''
  return {
    label,
    route,
    fullRoute: route,
    mdPath,
    status: getStatus(content),
    description: desc(content),
  }
}

function section(label, route, children, overviewMd) {
  const overview = overviewMd ? overviews[overviewMd] || '' : ''
  return {
    label,
    route,
    overview,
    children: children.map(c => {
      if (c.children) {
        return {
          ...c,
          children: c.children.map(leaf => ({
            ...leaf,
            fullRoute: `${route}/${c.route}/${leaf.route}`,
          }))
        }
      }
      return { ...c, fullRoute: `${route}/${c.route}` }
    }),
  }
}

export const manifest = [
  section('Kubernetes', 'kubernetes', [
    {
      label: 'Helm DaemonSet',
      route: 'helm-daemonset',
      children: [
        lab('Standard (EKS/GKE/AKS)', 'k8s-standard', 'kubernetes/helm-daemonset/k8s-standard/lab.md'),
        lab('EKS Hybrid Nodes', 'eks-hybrid', 'kubernetes/helm-daemonset/eks-hybrid/lab.md'),
        lab('GKE Autopilot', 'gke-autopilot', 'kubernetes/helm-daemonset/gke-autopilot/lab.md'),
      ],
    },
    {
      label: 'Helm Sidecar',
      route: 'helm-sidecar',
      children: [
        lab('Any Cluster', 'any-cluster', 'kubernetes/helm-sidecar/any-cluster/lab.md'),
        lab('EKS Fargate', 'eks-fargate', 'kubernetes/helm-sidecar/eks-fargate/lab.md'),
        lab('AKS Virtual Nodes', 'aks-virtual-nodes', 'kubernetes/helm-sidecar/aks-virtual-nodes/lab.md'),
      ],
    },
    {
      label: 'Operator',
      route: 'operator',
      children: [
        lab('Generic', 'generic', 'kubernetes/operator/generic/lab.md'),
        lab('OpenShift', 'openshift', 'kubernetes/operator/openshift/lab.md'),
        lab('Tainted Nodes', 'tainted-nodes', 'kubernetes/operator/tainted-nodes/lab.md'),
      ],
    },
  ], 'kubernetes/README.md'),

  section('ECS', 'ecs', [
    lab('Fargate Task Patching', 'fargate-task-patching', 'ecs/fargate-task-patching/lab.md'),
    lab('Fargate Falcon Utility', 'fargate-falcon-utility', 'ecs/fargate-falcon-utility/lab.md'),
    lab('EC2 Daemon Service', 'ec2-daemon-service', 'ecs/ec2-daemon-service/lab.md'),
  ], 'ecs/README.md'),

  section('VMs', 'vms', [
    {
      label: 'Linux',
      route: 'linux',
      children: [
        lab('Ansible', 'ansible', 'vms/linux/ansible/lab.md'),
        lab('GCE Startup Script', 'gce-startup-script', 'vms/linux/gce-startup-script/lab.md'),
        lab('Terraform UserData', 'terraform-userdata', 'vms/linux/terraform-userdata/lab.md'),
        lab('Packer AMI', 'packer-ami', 'vms/linux/packer-ami/lab.md'),
        lab('Chef', 'chef', 'vms/linux/chef/lab.md'),
        lab('Puppet', 'puppet', 'vms/linux/puppet/lab.md'),
        lab('AWS SSM', 'aws-ssm', 'vms/linux/aws-ssm/lab.md'),
        lab('Manual CLI', 'manual-cli', 'vms/linux/manual-cli/lab.md'),
      ],
    },
    {
      label: 'Windows',
      route: 'windows',
      children: [
        lab('GPO', 'gpo', 'vms/windows/gpo/lab.md'),
        lab('Intune', 'intune', 'vms/windows/intune/lab.md'),
        lab('SCCM', 'sccm', 'vms/windows/sccm/lab.md'),
        lab('Packer AMI', 'packer-ami', 'vms/windows/packer-ami/lab.md'),
        lab('AWS SSM', 'aws-ssm', 'vms/windows/aws-ssm/lab.md'),
        lab('Manual CLI', 'manual-cli', 'vms/windows/manual-cli/lab.md'),
      ],
    },
  ], 'vms/README.md'),

  section('Container Image Patching', 'container-image-patching', [
    lab('Local Docker', 'local-docker', 'container-image-patching/local-docker/lab.md'),
    lab('GitHub Actions', 'github-actions', 'container-image-patching/github-actions/lab.md'),
    lab('GitLab CI', 'gitlab-ci', 'container-image-patching/gitlab-ci/lab.md'),
    lab('Jenkins', 'jenkins', 'container-image-patching/jenkins/lab.md'),
  ], 'container-image-patching/README.md'),

  section('Serverless Containers', 'serverless-containers', [
    lab('Azure Container Apps', 'azure-container-apps', 'serverless-containers/azure-container-apps/lab.md'),
    lab('Azure Container Instances', 'azure-container-instances', 'serverless-containers/azure-container-instances/lab.md'),
    lab('Cloud Run', 'cloud-run', 'serverless-containers/cloud-run/lab.md'),
  ], 'serverless-containers/README.md'),

  section('FCS CLI', 'fcs-cli', [
    lab('GitHub Actions Image Scan', 'github-actions-image-scan', 'fcs-cli/github-actions-image-scan/lab.md'),
  ]),

  section('Common (Reference)', 'common', [
    lab('API Credentials', 'api-credentials', '_common/api-credentials.md'),
    lab('Pull Sensor Images', 'pull-sensor-images', '_common/pull-sensor-images.md'),
    lab('Verification', 'verification', '_common/verification.md'),
  ]),
]

export function getLabContent(fullRoute) {
  for (const sec of manifest) {
    if (!sec.children) continue
    for (const child of sec.children) {
      if (child.children) {
        for (const leaf of child.children) {
          if (leaf.fullRoute === fullRoute) {
            return labs[leaf.mdPath] || ''
          }
        }
      } else if (child.fullRoute === fullRoute) {
        return labs[child.mdPath] || ''
      }
    }
  }
  return ''
}

export function getLabMeta(fullRoute) {
  for (const sec of manifest) {
    if (!sec.children) continue
    for (const child of sec.children) {
      if (child.children) {
        for (const leaf of child.children) {
          if (leaf.fullRoute === fullRoute) return leaf
        }
      } else if (child.fullRoute === fullRoute) {
        return child
      }
    }
  }
  return null
}

export function getAllLabs() {
  const result = []
  for (const sec of manifest) {
    if (!sec.children) continue
    for (const child of sec.children) {
      if (child.children) {
        for (const leaf of child.children) {
          result.push(leaf)
        }
      } else {
        result.push(child)
      }
    }
  }
  return result
}
