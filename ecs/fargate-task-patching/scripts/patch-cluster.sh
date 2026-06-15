#!/bin/bash

# Function to display usage information
usage() {
    echo "Usage: $0 -c <cluster-name> -r <region> -u <falcon-client-id> -s <falcon-client-secret>"
    echo "  -r: AWS region (required)"
    echo "  -c: AWS ECS cluster name (required)"
    echo "  -u: CrowdStrike falcon client ID (required)"
    echo "  -s: CrowdStrike falcon client secret (required)"
    exit 1
}

# Check if JQ is installed.
if ! command -v jq &> /dev/null; then
    echo "JQ could not be found."
    exit 1
fi

# Check if curl is installed.
if ! command -v curl &> /dev/null; then
    echo "curl could not be found."
    exit 1
fi

# Check if docker is installed.
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker and try again."
    exit 1
fi

# Check if docker daemon is running
if ! docker info &> /dev/null; then
    echo "Error: Docker daemon is not running"
    exit 1
fi

# Function to handle errors
handle_error() {
    local error_message="$1"
    echo "Error occurred: $error_message" >&2
    echo "$error_message" > $selected_service/error.txt
    exit 1
}

# Function to remove managed parameters from original task definition
remove_keys() {
    local json_file="$1"
    local temp_file="${json_file}.temp"

    jq 'del(.requiresAttributes, 
             .status, 
             .revision, 
             .compatibilities, 
             .registeredAt, 
             .registeredBy, 
             .taskDefinitionArn, 
             if .tags == [] then .tags else empty end)' "$json_file" > "$temp_file"

    mv "$temp_file" "$json_file"
}

# Function to check if a repository exists
check_repository_exists() {
    aws ecr describe-repositories --repository-names "$repo_name" --region $region >/dev/null 2>&1
    return $?
}

# Function to create a repository for falcon container sensor
create_repository() {
    aws ecr create-repository --repository-name "$repo_name" --region $region >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "Repository $1 created successfully."
    else
        echo "Failed to create repository $1."
        exit 1
    fi
}

# Set error handling
set -e
trap 'handle_error "An error occurred at line $LINENO"' ERR

# Parse command line arguments
while getopts ":r:c:u:s:" opt; do
    case $opt in
        r) region="$OPTARG" ;;
        c) cluster_name="$OPTARG" ;;
        u) falcon_client_id="$OPTARG" ;;
        s) falcon_client_secret="$OPTARG" ;;
        \?) echo "Invalid option -$OPTARG" >&2; usage ;;
    esac
done

# Initialize variables
region="$region"
cluster_name="$cluster_name"
app_arch=""

echo ""
echo "Listing Fargate services in cluster: $cluster_name"
echo ""


# Main code
{

    # Variables
    export FALCON_CLIENT_ID=$falcon_client_id
    export FALCON_CLIENT_SECRET=$falcon_client_secret
    export FALCON_CID=$(bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) -t falcon-container --get-cid)
    export LATESTSENSOR=$(bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) -p $app_arch -t falcon-container | tail -1)
    export FALCON_IMAGE_TAG=$(echo $LATESTSENSOR | cut -d':' -f 2)
    export ACCOUNT_ID=$(aws ecs describe-clusters --clusters $cluster_name --region $region --query 'clusters[0].clusterArn' --output text | awk -F: '{print $5}')


    # Get list of Fargate services in the cluster
    services=$(aws ecs list-services --cluster "$cluster_name" --region "$region" --output json | jq -r '.serviceArns | sort[]')
    
    # Check if any services were found
    if [ -z "$services" ]; then
        echo "No services found in cluster $cluster_name"
        exit 0
    fi

    for service in $services; do
        service_name=$(basename "$service")
        echo "- $service_name"
    done

    OUTPUT_DIR="ecs_fargate_services"

    # Create output directory to store task definitions configurations
    mkdir -p "$OUTPUT_DIR" && cd $OUTPUT_DIR

    # Identify container image architecture
    architecture=$(aws ecs describe-task-definition --task-definition "$task_def_name" --region $region --query 'taskDefinition.runtimePlatform.cpuArchitecture' --output text)
    if [ "$architecture" == "ARM64" ]; then
        app_arch="aarch64"
    elif [ "$architecture" == "X86_64" ]; then
        app_arch="x86_64"
    else
        app_arch="x86_64"
    fi

    echo ""
    read -p "Do you have an existing AWS ECR repository for Falcon Container Sensor (yes/no)? " has_repo

    while true; do 
        if [ "$has_repo" = "yes" ] || [ "$has_repo" = "y" ]|| [ "$has_repo" = "Yes" ] || [ "$has_repo" = "Y" ]; then

            # List all task definition families
            ecr_repositories_list=$(aws ecr describe-repositories --region $region --query 'repositories[*].repositoryName | sort(@)' --output text)


            # Get the latest version of each task definition family
            for repo in $ecr_repositories_list; do
                ecr_repositories+=("$repo")
            done

            # Display task definitions with numbers, one per line
            echo "Available ECR registries:"
            for i in "${!ecr_repositories[@]}"; do
                echo "$((i+1)). ${ecr_repositories[$i]}"
            done
            echo ""
            # Ask user to select falcon container sensor ECR repo
            read -p "Enter the number of the ECR repository used for Falcon Container Sensor: " selection

            # Validate user input
            if ! [[ "$selection" =~ ^[0-9]+$ ]] || [ "$selection" -lt 1 ] || [ "$selection" -gt "${#ecr_repositories[@]}" ]; then
                echo "Invalid selection. Exiting."
                exit 1
            fi

            # Get selected task definition
            repo_name="${ecr_repositories[$((selection-1))]}" 
            break 

        elif [ "$has_repo" = "no" ] || [ "$has_repo" = "n" ]|| [ "$has_repo" = "No" ] || [ "$has_repo" = "N" ]; then
            repo_name="crowdstrike"
            echo "Checking if repository $repo_name exists..."
            if check_repository_exists "$repo_name"; then
                echo "Repository $repo_name already exists."
            else
                echo "Creating repository $repo_name..."
                create_repository "$repo_name"
            fi
            break
        else
            echo "Invalid input. Please answer 'yes' or 'no'."
            read -p "Do you have an existing AWS ECR repository for Falcon Container Sensor (yes/no)? " has_repo
        fi
    done

    # Set the new image repo as a variable
    export AWS_REPO=$(aws ecr describe-repositories --repository-name $repo_name --region $region | jq -r  '.repositories[].repositoryUri')
    ECR_LOGIN=$(aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$region.amazonaws.com)

    # tag and push container sensor to your falcon registry
    echo "Pushing latest falcon container sensor image to $repo_name"
    docker tag "$LATESTSENSOR" "$AWS_REPO":"$FALCON_IMAGE_TAG"
    docker_push=$(docker push "$AWS_REPO":"$FALCON_IMAGE_TAG")

    # Display list of services
    echo "Patching all services on $cluster_name with Falcon Container Sensor"
    for service in $services; do
        service_name=$(basename "$service")
        task_def=$(aws ecs describe-services --cluster "$cluster_name" --services "$service" --region "$region" --query 'services[0].taskDefinition' --output text)
        task_def_name=$(basename "$task_def" | cut -d':' -f1)

        # Create folder for the task definition to be patched
        mkdir -p "$service_name"
        echo ""

        ORIGINAL_TASK_DEFINITION=$service_name/${task_def_name}.json

        # Get the latest task definition configuration and export to a json file
        aws ecs describe-task-definition --task-definition "$task_def" --region $region --query 'taskDefinition' --output json > "$ORIGINAL_TASK_DEFINITION"
        echo "Original task definition from $service_name exported to $OUTPUT_DIR/$ORIGINAL_TASK_DEFINITION"

        # Get the task definition configuration and save to a temporary file
        cleaned_file="$service_name/${task_def_name}-cleaned.json"
        cp "$ORIGINAL_TASK_DEFINITION" "$cleaned_file"
        remove_keys "$cleaned_file"

        # CrowdStrike Variables        
        export JSON_STRING=$(cat $cleaned_file)

        echo "Patching Task Definition $task_def_name from $service_name with Falcon Container Sensor"

        ARCH=$(uname -m)
        if [ "$ARCH" == "arm64" ]; then
            export IMAGE_PULL_TOKEN=$(echo "{\"auths\":{\"${ACCOUNT_ID}.dkr.ecr.${region}.amazonaws.com\":{\"auth\":\"$(echo AWS:$(aws ecr get-login-password --region ${region})|base64 )\"}}}" | base64)
            docker run --platform linux/amd64 \
            --rm "$AWS_REPO":"$FALCON_IMAGE_TAG" \
            -cid $FALCON_CID \
            -image "$AWS_REPO":"$FALCON_IMAGE_TAG" \
            -pulltoken $IMAGE_PULL_TOKEN \
            -ecs-spec "$JSON_STRING" > $service_name/${task_def_name}-patched.json
        else
            export IMAGE_PULL_TOKEN=$(echo "{\"auths\":{\"${ACCOUNT_ID}.dkr.ecr.${region}.amazonaws.com\":{\"auth\":\"$(echo AWS:$(aws ecr get-login-password --region ${region})|base64 -w 0)\"}}}" | base64 -w 0)
            docker run --platform linux \
            --rm "$AWS_REPO":"$FALCON_IMAGE_TAG" \
            -cid $FALCON_CID \
            -image "$AWS_REPO":"$FALCON_IMAGE_TAG" \
            -pulltoken $IMAGE_PULL_TOKEN \
            -ecs-spec "$JSON_STRING" > $service_name/${task_def_name}-patched.json
        fi

        rm -f $cleaned_file

        echo "Registering patched task definition on AWS"
        task_register=$(aws ecs register-task-definition --region $region --cli-input-json file://$service_name/${task_def_name}-patched.json)

    done
} || handle_error "Failed to update task definition"