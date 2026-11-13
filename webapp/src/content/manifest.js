// Import all lab markdown files explicitly using the @content alias (resolves to repo root)
import k8sStandard from '@content/kubernetes/helm-daemonset/k8s-standard/lab.md?raw'
import k8sEksHybrid from '@content/kubernetes/helm-daemonset/eks-hybrid/lab.md?raw'
import k8sGkeAutopilot from '@content/kubernetes/helm-daemonset/gke-autopilot/lab.md?raw'
import k8sSidecarFargate from '@content/kubernetes/helm-sidecar/eks-fargate/lab.md?raw'
import k8sOpGeneric from '@content/kubernetes/operator/generic/lab.md?raw'
import k8sOpOpenshift from '@content/kubernetes/operator/openshift/lab.md?raw'
import ecsFargatePatch from '@content/ecs/fargate-task-patching/lab.md?raw'
import ecsFargateUtility from '@content/ecs/fargate-falcon-utility/lab.md?raw'
import ecsFargateTerraform from '@content/ecs/fargate-terraform-module/lab.md?raw'
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
import cspmAwsTerraform from '@content/cspm/account-registration/aws/terraform/lab.md?raw'
import cspmAwsCfn from '@content/cspm/account-registration/aws/cloudformation/lab.md?raw'
import cspmAzureTerraform from '@content/cspm/account-registration/azure/terraform/lab.md?raw'
import cspmAzureBicep from '@content/cspm/account-registration/azure/bicep/lab.md?raw'
import cspmGcpTerraform from '@content/cspm/account-registration/gcp/terraform/lab.md?raw'
import cspmGcpRm from '@content/cspm/account-registration/gcp/resource-manager/lab.md?raw'
import commonApiCreds from '@content/_common/api-credentials.md?raw'
import commonPullImages from '@content/_common/pull-sensor-images.md?raw'
import commonVerification from '@content/_common/verification.md?raw'
import seYasi from '@content/se-built/yet-another-sensor-installer.md?raw'
import seEcsFargate from '@content/se-built/ecs-fargate-sidecar-injector.md?raw'
import seRegoExamples from '@content/se-built/simple-rego-examples.md?raw'
import seAzurePreReqs from '@content/se-built/azure-fcs-prereqs-checker.md?raw'

// Overview READMEs
import overviewK8s from '@content/kubernetes/README.md?raw'
import overviewEcs from '@content/ecs/README.md?raw'
import overviewCip from '@content/container-image-patching/README.md?raw'

// Map paths to content
const labs = {
  'kubernetes/helm-daemonset/k8s-standard/lab.md': k8sStandard,
  'kubernetes/helm-daemonset/eks-hybrid/lab.md': k8sEksHybrid,
  'kubernetes/helm-daemonset/gke-autopilot/lab.md': k8sGkeAutopilot,
  'kubernetes/helm-sidecar/eks-fargate/lab.md': k8sSidecarFargate,
  'kubernetes/operator/generic/lab.md': k8sOpGeneric,
  'kubernetes/operator/openshift/lab.md': k8sOpOpenshift,
  'ecs/fargate-task-patching/lab.md': ecsFargatePatch,
  'ecs/fargate-falcon-utility/lab.md': ecsFargateUtility,
  'ecs/fargate-terraform-module/lab.md': ecsFargateTerraform,
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
  'cspm/account-registration/aws/terraform/lab.md': cspmAwsTerraform,
  'cspm/account-registration/aws/cloudformation/lab.md': cspmAwsCfn,
  'cspm/account-registration/azure/terraform/lab.md': cspmAzureTerraform,
  'cspm/account-registration/azure/bicep/lab.md': cspmAzureBicep,
  'cspm/account-registration/gcp/terraform/lab.md': cspmGcpTerraform,
  'cspm/account-registration/gcp/resource-manager/lab.md': cspmGcpRm,
  '_common/api-credentials.md': commonApiCreds,
  '_common/pull-sensor-images.md': commonPullImages,
  '_common/verification.md': commonVerification,
  'se-built/yet-another-sensor-installer.md': seYasi,
  'se-built/ecs-fargate-sidecar-injector.md': seEcsFargate,
  'se-built/simple-rego-examples.md': seRegoExamples,
  'se-built/azure-fcs-prereqs-checker.md': seAzurePreReqs,
}

const overviews = {
  'kubernetes/README.md': overviewK8s,
  'ecs/README.md': overviewEcs,
  'container-image-patching/README.md': overviewCip,
}

// -----------------------------------------------------------------------------
// Canonical labs. `id` is the ORIGINAL route (kept so saved checkbox progress,
// lab variables and old bookmarks still resolve). Navigation placements below
// point at these ids, so a lab can appear under several clouds.
//
// Modernization: only labs with `modernized: true` are green. Everything else is
// yellow "Legacy · Roadmap" until it's brought up to the current lab standard.
// `reference: true` marks docs that aren't deployment labs (no roadmap tracking).
// -----------------------------------------------------------------------------
const labVars = (name, region) => ({
  modes: ['lab'],
  fields: [
    { key: 'CLUSTER_NAME', label: 'Cluster name', type: 'text', default: name },
    { key: 'REGION',       label: 'Region',       type: 'text', default: region },
  ],
})

const LABS = [
  {
    id: 'kubernetes/helm-daemonset/k8s-standard',
    label: 'Standard (EKS/GKE/AKS)',
    area: 'Kubernetes · Helm DaemonSet',
    md: 'kubernetes/helm-daemonset/k8s-standard/lab.md',
    modernized: true,
    variables: {
      modes: ['lab'],
      fields: [
        {
          key: 'CLOUD',
          label: 'Cloud',
          type: 'select',
          default: 'gke',
          options: [
            { value: 'gke', label: 'GKE',  regionLabel: 'Zone',     regionDefault: 'us-central1-a' },
            { value: 'eks', label: 'EKS',  regionLabel: 'Region',   regionDefault: 'us-east-1'   },
            { value: 'aks', label: 'AKS',  regionLabel: 'Location', regionDefault: 'eastus'      },
          ],
        },
        { key: 'CLUSTER_NAME', label: 'Cluster name', type: 'text', default: 'falcon-helm-lab' },
        { key: 'REGION',       label: 'Region',       type: 'text' },
      ],
    },
  },
  {
    id: 'kubernetes/helm-daemonset/eks-hybrid',
    label: 'EKS Hybrid Nodes',
    area: 'Kubernetes · Helm DaemonSet',
    md: 'kubernetes/helm-daemonset/eks-hybrid/lab.md',
    variables: labVars('falcon-hybrid-lab', 'us-east-1'),
  },
  {
    id: 'kubernetes/helm-daemonset/gke-autopilot',
    label: 'GKE Autopilot',
    area: 'Kubernetes · Helm DaemonSet',
    md: 'kubernetes/helm-daemonset/gke-autopilot/lab.md',
    variables: labVars('falcon-autopilot-lab', 'us-central1'),
  },
  {
    id: 'kubernetes/helm-sidecar/eks-fargate',
    label: 'EKS Fargate',
    area: 'Kubernetes · Helm Sidecar',
    md: 'kubernetes/helm-sidecar/eks-fargate/lab.md',
    modernized: true,
    variables: labVars('falcon-fargate-lab', 'us-east-1'),
  },
  { id: 'kubernetes/operator/generic',   label: 'Generic',   area: 'Kubernetes · Operator', md: 'kubernetes/operator/generic/lab.md' },
  { id: 'kubernetes/operator/openshift', label: 'OpenShift', area: 'Kubernetes · Operator', md: 'kubernetes/operator/openshift/lab.md' },

  { id: 'ecs/fargate-task-patching',   label: 'Fargate Task Patching',   area: 'ECS', md: 'ecs/fargate-task-patching/lab.md' },
  { id: 'ecs/fargate-falcon-utility',  label: 'Fargate Falcon Utility',  area: 'ECS', md: 'ecs/fargate-falcon-utility/lab.md' },
  { id: 'ecs/fargate-terraform-module', label: 'Fargate Terraform Module', area: 'ECS', md: 'ecs/fargate-terraform-module/lab.md', modernized: true },
  { id: 'ecs/ec2-daemon-service',      label: 'EC2 Daemon Service',      area: 'ECS', md: 'ecs/ec2-daemon-service/lab.md' },

  { id: 'vms/linux/ansible',            label: 'Ansible',            area: 'VMs · Linux', md: 'vms/linux/ansible/lab.md' },
  { id: 'vms/linux/gce-startup-script', label: 'GCE Startup Script', area: 'VMs · Linux', md: 'vms/linux/gce-startup-script/lab.md' },
  { id: 'vms/linux/terraform-userdata', label: 'Terraform UserData', area: 'VMs · Linux', md: 'vms/linux/terraform-userdata/lab.md' },
  { id: 'vms/linux/packer-ami',         label: 'Packer AMI',         area: 'VMs · Linux', md: 'vms/linux/packer-ami/lab.md' },
  { id: 'vms/linux/chef',               label: 'Chef',               area: 'VMs · Linux', md: 'vms/linux/chef/lab.md' },
  { id: 'vms/linux/puppet',             label: 'Puppet',             area: 'VMs · Linux', md: 'vms/linux/puppet/lab.md' },
  { id: 'vms/linux/aws-ssm',            label: 'AWS SSM',            area: 'VMs · Linux', md: 'vms/linux/aws-ssm/lab.md' },
  { id: 'vms/linux/manual-cli',         label: 'Manual CLI',         area: 'VMs · Linux', md: 'vms/linux/manual-cli/lab.md' },

  { id: 'vms/windows/gpo',        label: 'GPO',        area: 'VMs · Windows', md: 'vms/windows/gpo/lab.md' },
  { id: 'vms/windows/intune',     label: 'Intune',     area: 'VMs · Windows', md: 'vms/windows/intune/lab.md' },
  { id: 'vms/windows/sccm',       label: 'SCCM',       area: 'VMs · Windows', md: 'vms/windows/sccm/lab.md' },
  { id: 'vms/windows/packer-ami', label: 'Packer AMI', area: 'VMs · Windows', md: 'vms/windows/packer-ami/lab.md' },
  { id: 'vms/windows/aws-ssm',    label: 'AWS SSM',    area: 'VMs · Windows', md: 'vms/windows/aws-ssm/lab.md' },
  { id: 'vms/windows/manual-cli', label: 'Manual CLI', area: 'VMs · Windows', md: 'vms/windows/manual-cli/lab.md' },

  { id: 'container-image-patching/local-docker', label: 'Local Docker',   area: 'Container Image Patching', md: 'container-image-patching/local-docker/lab.md' },
  { id: 'container-image-patching/github-actions', label: 'GitHub Actions', area: 'Container Image Patching', md: 'container-image-patching/github-actions/lab.md' },
  { id: 'container-image-patching/gitlab-ci',    label: 'GitLab CI',      area: 'Container Image Patching', md: 'container-image-patching/gitlab-ci/lab.md' },
  { id: 'container-image-patching/jenkins',      label: 'Jenkins',        area: 'Container Image Patching', md: 'container-image-patching/jenkins/lab.md' },

  { id: 'serverless-containers/azure-container-apps',      label: 'Azure Container Apps',      area: 'Serverless Containers', md: 'serverless-containers/azure-container-apps/lab.md' },
  { id: 'serverless-containers/azure-container-instances', label: 'Azure Container Instances', area: 'Serverless Containers', md: 'serverless-containers/azure-container-instances/lab.md' },
  { id: 'serverless-containers/cloud-run',                 label: 'Cloud Run',                 area: 'Serverless Containers', md: 'serverless-containers/cloud-run/lab.md' },

  { id: 'fcs-cli/github-actions-image-scan', label: 'GitHub Actions Image Scan', area: 'FCS CLI', md: 'fcs-cli/github-actions-image-scan/lab.md' },
  { id: 'cspm/account-registration/aws-terraform', label: 'AWS Terraform', area: 'Cloud Registration', md: 'cspm/account-registration/aws/terraform/lab.md' },
  { id: 'cspm/account-registration/aws-cloudformation', label: 'AWS CloudFormation', area: 'Cloud Registration', md: 'cspm/account-registration/aws/cloudformation/lab.md' },
  { id: 'cspm/account-registration/azure-terraform', label: 'Azure Terraform', area: 'Cloud Registration', md: 'cspm/account-registration/azure/terraform/lab.md' },
  { id: 'cspm/account-registration/azure-bicep', label: 'Azure Bicep', area: 'Cloud Registration', md: 'cspm/account-registration/azure/bicep/lab.md' },
  { id: 'cspm/account-registration/gcp-terraform', label: 'GCP Terraform', area: 'Cloud Registration', md: 'cspm/account-registration/gcp/terraform/lab.md' },
  { id: 'cspm/account-registration/gcp-resource-manager', label: 'GCP Resource Manager', area: 'Cloud Registration', md: 'cspm/account-registration/gcp/resource-manager/lab.md' },

  { id: 'common/api-credentials',   label: 'API Credentials',   area: 'Reference', md: '_common/api-credentials.md',   reference: true },
  { id: 'common/pull-sensor-images', label: 'Pull Sensor Images', area: 'Reference', md: '_common/pull-sensor-images.md', reference: true },
  { id: 'common/verification',      label: 'Verification',      area: 'Reference', md: '_common/verification.md',      reference: true },

  { id: 'se-built/yet-another-sensor-installer', label: 'Yet Another Sensor Installer', area: 'SE-Built', md: 'se-built/yet-another-sensor-installer.md', reference: true },
  { id: 'se-built/ecs-fargate-sidecar-injector', label: 'ECS Fargate Sidecar Injector', area: 'SE-Built', md: 'se-built/ecs-fargate-sidecar-injector.md', reference: true },
  { id: 'se-built/simple-rego-examples',         label: 'Simple Rego Examples',         area: 'SE-Built', md: 'se-built/simple-rego-examples.md',         reference: true },
  { id: 'se-built/azure-fcs-prereqs-checker',    label: 'Azure FCS Pre-Reqs Checker',    area: 'SE-Built', md: 'se-built/azure-fcs-prereqs-checker.md',    reference: true },
]

// contentKind = what's actually in the file; state = where it sits on the modernization roadmap.
function getContentKind(content) {
  if (!content || content.trim().length === 0) return 'empty'
  if (content.includes('> **Status:**') || content.includes('Steps not yet written')) return 'stub'
  return 'written'
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

const labById = Object.fromEntries(LABS.map(def => {
  const content = labs[def.md] || ''
  const state = def.reference ? 'reference' : def.modernized ? 'modern' : 'legacy'
  return [def.id, { ...def, contentKind: getContentKind(content), state, description: desc(content) }]
}))

// -----------------------------------------------------------------------------
// Cloud-first navigation. Each placement is a route that renders a canonical lab.
// `cloudPreset` pre-selects the CLOUD picker (k8s-standard), `primary` marks the
// placement that old bookmarks redirect to (defaults to the first one).
// -----------------------------------------------------------------------------
const placements = []
const placementByRoute = {}

const l = (id, route, extra = {}) => ({ id, route, ...extra })
const g = (label, route, children, overviewMd) => ({
  label,
  route,
  children,
  overview: overviewMd ? overviews[overviewMd] || '' : '',
})

function buildLeaf(spec, base, cloudRoute) {
  const lab = labById[spec.id]
  if (!lab) throw new Error(`manifest: unknown lab id "${spec.id}"`)
  const fullRoute = `${base}/${spec.route}`
  const placement = {
    ...lab,
    label: spec.label || lab.label,
    route: spec.route,
    fullRoute,
    canonical: spec.id,
    cloud: cloudRoute,
    cloudPreset: spec.cloudPreset,
    primary: !!spec.primary,
  }
  placements.push(placement)
  placementByRoute[fullRoute] = placement
  return placement
}

// Groups nest to any depth (cloud -> service -> OS/variant -> lab).
function build(spec, base, cloudRoute) {
  if (!spec.children) return buildLeaf(spec, base, cloudRoute)
  const path = `${base}/${spec.route}`
  return { ...spec, path, children: spec.children.map(c => build(c, path, cloudRoute)) }
}

function cloud(label, route, logo, description, children) {
  return {
    label,
    route,
    path: route,
    logo,
    description,
    children: children.map(c => build(c, route, route)),
  }
}

const K8S = 'kubernetes/helm-daemonset/k8s-standard'

export const manifest = [
  cloud('AWS', 'aws', 'aws', 'EKS, ECS, EC2 fleets, and AWS account registration.', [
    g('EKS', 'eks', [
      l(K8S, 'standard', { label: 'Standard (EC2 Node Groups)', cloudPreset: 'eks' }),
      l('kubernetes/helm-sidecar/eks-fargate', 'fargate'),
      l('kubernetes/helm-daemonset/eks-hybrid', 'hybrid-nodes'),
    ]),
    g('ECS', 'ecs', [
      g('Fargate', 'fargate', [
        l('ecs/fargate-task-patching', 'task-patching', { label: 'Task Patching' }),
        l('ecs/fargate-falcon-utility', 'falcon-utility', { label: 'Falcon Utility' }),
        l('ecs/fargate-terraform-module', 'terraform-module', { label: 'Terraform Module' }),
      ]),
      l('ecs/ec2-daemon-service', 'ec2-daemon-service'),
    ], 'ecs/README.md'),
    g('EC2', 'ec2', [
      g('Linux', 'linux', [
        l('vms/linux/aws-ssm', 'aws-ssm'),
        l('vms/linux/packer-ami', 'packer-ami'),
        l('vms/linux/terraform-userdata', 'terraform-userdata'),
        l('vms/linux/ansible', 'ansible'),
        l('vms/linux/manual-cli', 'manual-cli'),
      ]),
      g('Windows', 'windows', [
        l('vms/windows/aws-ssm', 'aws-ssm'),
        l('vms/windows/packer-ami', 'packer-ami'),
        l('vms/windows/manual-cli', 'manual-cli'),
      ]),
    ]),
    g('Account Registration', 'registration', [
      l('cspm/account-registration/aws-terraform', 'terraform', { label: 'Terraform' }),
      l('cspm/account-registration/aws-cloudformation', 'cloudformation', { label: 'CloudFormation' }),
    ]),
  ]),

  cloud('Azure', 'azure', 'azure', 'AKS, Container Instances, Container Apps, virtual machines, and Azure account registration.', [
    g('AKS', 'aks', [
      l(K8S, 'standard', { label: 'Standard', cloudPreset: 'aks' }),
    ]),
    l('serverless-containers/azure-container-instances', 'container-instances', { label: 'Container Instances (ACI)' }),
    l('serverless-containers/azure-container-apps', 'container-apps', { label: 'Container Apps' }),
    g('Virtual Machines', 'vms', [
      g('Linux', 'linux', [
        l('vms/linux/ansible', 'ansible'),
        l('vms/linux/manual-cli', 'manual-cli'),
      ]),
      g('Windows', 'windows', [
        l('vms/windows/intune', 'intune'),
        l('vms/windows/manual-cli', 'manual-cli'),
      ]),
    ]),
    g('Account Registration', 'registration', [
      l('cspm/account-registration/azure-terraform', 'terraform', { label: 'Terraform' }),
      l('cspm/account-registration/azure-bicep', 'bicep', { label: 'Bicep' }),
    ]),
  ]),

  cloud('Google Cloud', 'gcp', 'gcp', 'GKE, Cloud Run, Compute Engine, and GCP account registration.', [
    g('GKE', 'gke', [
      l(K8S, 'standard', { label: 'Standard', cloudPreset: 'gke' }),
      l('kubernetes/helm-daemonset/gke-autopilot', 'autopilot'),
    ]),
    l('serverless-containers/cloud-run', 'cloud-run', { label: 'Cloud Run' }),
    g('Compute Engine', 'compute-engine', [
      g('Linux', 'linux', [
        l('vms/linux/gce-startup-script', 'startup-script'),
        l('vms/linux/ansible', 'ansible'),
        l('vms/linux/manual-cli', 'manual-cli'),
      ]),
    ]),
    g('Account Registration', 'registration', [
      l('cspm/account-registration/gcp-terraform', 'terraform', { label: 'Terraform' }),
      l('cspm/account-registration/gcp-resource-manager', 'resource-manager', { label: 'Resource Manager' }),
    ]),
  ]),

  cloud('Any Cloud / Tooling', 'any-cloud', 'any', 'Cloud-agnostic tooling: any Kubernetes cluster, the Falcon Operator, image patching, FCS CLI, configuration management, and reference guides.', [
    g('Kubernetes', 'kubernetes', [
      l(K8S, 'standard', { label: 'Standard (Any Cluster)', primary: true }),
      l('kubernetes/operator/generic', 'operator'),
      l('kubernetes/operator/openshift', 'openshift'),
    ], 'kubernetes/README.md'),
    g('Container Image Patching', 'container-image-patching', [
      l('container-image-patching/local-docker', 'local-docker'),
      l('container-image-patching/github-actions', 'github-actions'),
      l('container-image-patching/gitlab-ci', 'gitlab-ci'),
      l('container-image-patching/jenkins', 'jenkins'),
    ], 'container-image-patching/README.md'),
    g('FCS CLI', 'fcs-cli', [
      l('fcs-cli/github-actions-image-scan', 'github-actions-image-scan'),
    ]),
    g('Linux VMs', 'linux-vms', [
      l('vms/linux/ansible', 'ansible', { primary: true }),
      l('vms/linux/chef', 'chef'),
      l('vms/linux/puppet', 'puppet'),
      l('vms/linux/manual-cli', 'manual-cli', { primary: true }),
    ]),
    g('Windows VMs', 'windows-vms', [
      l('vms/windows/gpo', 'gpo'),
      l('vms/windows/sccm', 'sccm'),
      l('vms/windows/manual-cli', 'manual-cli', { primary: true }),
    ]),
    g('Reference', 'reference', [
      l('common/api-credentials', 'api-credentials'),
      l('common/pull-sensor-images', 'pull-sensor-images'),
      l('common/verification', 'verification'),
    ]),
    g('SE-Built Tools', 'se-built', [
      l('se-built/yet-another-sensor-installer', 'yet-another-sensor-installer'),
      l('se-built/ecs-fargate-sidecar-injector', 'ecs-fargate-sidecar-injector'),
      l('se-built/simple-rego-examples', 'simple-rego-examples'),
      l('se-built/azure-fcs-prereqs-checker', 'azure-fcs-prereqs-checker'),
    ]),
  ]),
]

// Every canonical lab must be reachable from the nav.
for (const def of LABS) {
  if (!placements.some(p => p.canonical === def.id)) {
    throw new Error(`manifest: lab "${def.id}" has no nav placement`)
  }
}

// One status vocabulary for the whole site:
//   modern    - brought up to the current lab standard (green)
//   legacy    - written, but not yet modernized (yellow)
//   roadmap   - not yet written and not yet modernized (yellow, hollow)
//   reference - supporting doc, not tracked on the roadmap (no badge)
export function getStatusKey(meta) {
  if (!meta || meta.state === 'reference') return 'reference'
  if (meta.state === 'modern') return 'modern'
  return meta.contentKind === 'written' ? 'legacy' : 'roadmap'
}

// Accepts either a nav route ("aws/eks/standard") or a canonical id ("kubernetes/helm-daemonset/k8s-standard").
function resolve(key) {
  return placementByRoute[key] || labById[key] || null
}

export function getLabContent(key) {
  const meta = resolve(key)
  return meta ? labs[meta.md] || '' : ''
}

export function getLabMeta(key) {
  return resolve(key)
}

const primaryPlacement = id => {
  const ps = placements.filter(p => p.canonical === id)
  return ps.find(p => p.primary) || ps[0]
}

// Old bookmarks: canonical ids map to their primary placement; old section/group
// prefixes ("kubernetes", "vms/linux", ...) map to the home page.
export function getRedirects() {
  const labRedirects = LABS.map(def => ({ from: def.id, to: `/${primaryPlacement(def.id).fullRoute}` }))
  const ids = new Set(LABS.map(def => def.id))
  const prefixes = new Set()
  for (const def of LABS) {
    const parts = def.id.split('/')
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('/')
      if (!ids.has(prefix)) prefixes.add(prefix)
    }
  }
  return { labRedirects, prefixRedirects: [...prefixes].map(from => ({ from, to: '/' })) }
}

const cloudLabel = Object.fromEntries(manifest.map(c => [c.route, c.label]))

// Roadmap rows exclude reference docs / SE-built tools (not deployment labs).
export function getRoadmap() {
  const rows = LABS
    .map(def => labById[def.id])
    .filter(lab => lab.state !== 'reference')
    .map(lab => ({
      id: lab.id,
      label: lab.label,
      area: lab.area,
      state: lab.state,
      contentKind: lab.contentKind,
      to: `/${primaryPlacement(lab.id).fullRoute}`,
      clouds: [...new Set(placements.filter(p => p.canonical === lab.id).map(p => cloudLabel[p.cloud]))],
    }))
  const rank = r => (r.state === 'modern' ? 0 : r.contentKind === 'written' ? 1 : 2)
  rows.sort((a, b) => rank(a) - rank(b))
  return {
    rows,
    total: rows.length,
    modernized: rows.filter(r => r.state === 'modern').length,
  }
}
