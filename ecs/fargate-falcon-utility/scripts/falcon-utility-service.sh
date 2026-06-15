#!/bin/bash

# Function to display usage information
usage() {
    echo "Usage: $0 -c <cluster-name>-r <region> -u <falcon-client-id> -s <falcon-client-secret>"
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

set -e
trap 'handle_error "An error occurred at line $LINENO"' ERR

# Parse command line arguments
while getopts ":r:c:u:s:t:" opt; do
    case $opt in
        r) region="$OPTARG" ;;
        c) cluster_name="$OPTARG" ;;
        u) falcon_client_id="$OPTARG" ;;
        s) falcon_client_secret="$OPTARG" ;;
        t) falcon_tag="$OPTARG" ;;
        \?) echo "Invalid option -$OPTARG" >&2; usage ;;
    esac
done


# Initialize variables
region="$region"
cluster_name="$cluster_name"
app_arch=""
falcon_tag=""

echo ""
echo "Listing Fargate services in cluster: $cluster_name"
echo ""

# Main code
{

    # Get list of Fargate services in the cluster
    services=$(aws ecs list-services --cluster "$cluster_name" --region "$region" --output json | jq -r '.serviceArns | sort[]')

    # Check if any services were found
    if [ -z "$services" ]; then
        echo "No services found in cluster $cluster_name"
        exit 0
    fi

    # Display list of services
    echo "Available Fargate services:"
    echo ""
    for service in $services; do
        service_name=$(basename "$service")
        echo "- $service_name"
    done

    echo ""

    # Prompt user for service selection
    read -p "Enter the name of the service you want to patch: " selected_service

    OUTPUT_DIR="ecs_fargate_services"

    # Create output directory to storage task definitions config
    mkdir -p "$OUTPUT_DIR" && cd $OUTPUT_DIR

    # Get task definition used for the service
    task_def=$(aws ecs describe-services --cluster "$cluster_name" --services "$selected_service" --region "$region" --query 'services[0].taskDefinition' --output text)
    echo "Collecting task definition from $selected_service: $task_def"

    # Extract task definition name
    task_def_name=$(basename "$task_def" | cut -d':' -f1)

    # List container images from task definition
    images=$(aws ecs describe-task-definition --task-definition "$task_def" --region "$region" | jq -r '.taskDefinition.containerDefinitions[].image' | tail -1)

    # Create a folder for the task definition
    mkdir -p "$selected_service"

    ORIGINAL_TASK_DEFINITION=$selected_service/${task_def_name}.json

    # Identify container image architecture
    architecture=$(aws ecs describe-task-definition --task-definition "$task_def_name" --region $region --query 'taskDefinition.runtimePlatform.cpuArchitecture' --output text)
    if [ "$architecture" == "ARM64" ]; then
        app_arch="aarch64"
    elif [ "$architecture" == "X86_64" ]; then
        app_arch="x86_64"
    else
        app_arch="x86_64"
    fi

    # Get task definition details and save to JSON file
    aws ecs describe-task-definition --task-definition "$task_def_name" --region $region --query 'taskDefinition' --output json > "$ORIGINAL_TASK_DEFINITION"

    echo "Original task definition exported to $OUTPUT_DIR/$ORIGINAL_TASK_DEFINITION"

    # Remove specified keys/attributes from json configuration file and save to a temp file
    cleaned_file="$selected_service/${task_def_name}-cleaned.json"
    cp "$ORIGINAL_TASK_DEFINITION" "$cleaned_file"
    remove_keys "$cleaned_file"

    echo "Cleaned task definition and saved to $OUTPUT_DIR/$cleaned_file"

    # Variables
    export FALCON_TAG=$falcon_tag
    export FALCON_CLIENT_ID=$falcon_client_id
    export FALCON_CLIENT_SECRET=$falcon_client_secret
    export FALCON_CID=$(bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) -t falcon-container --get-cid)
    export LATESTSENSOR=$(bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) -p $app_arch -t falcon-container | tail -1)
    export FALCON_IMAGE_TAG=$(echo $LATESTSENSOR | cut -d':' -f 2)
    export ACCOUNT_ID=$(aws ecs describe-clusters --clusters $cluster_name --region $region --query 'clusters[0].clusterArn' --output text | awk -F: '{print $5}')

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



    # Set falcon repository as a variable
    export AWS_REPO=$(aws ecr describe-repositories --repository-name $repo_name --region $region | jq -r  '.repositories[].repositoryUri' | tail -1)
    ECR_LOGIN=$(aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$region.amazonaws.com)

    # tag and push container sensor to your falcon registry
    echo "Pushing latest falcon container sensor image to $repo_name"
    docker tag "$LATESTSENSOR" "$AWS_REPO":"$FALCON_IMAGE_TAG"
    docker push "$AWS_REPO":"$FALCON_IMAGE_TAG"
    
    echo ""
    echo "Patching $task_def_name container images with Falcon Container Sensor"

    ARCH=$(uname -m)
    for image in $images; do
        echo "Pulling image $image locally to start the patching process"
        pull_image=$(docker pull $image)
        if [[ $image == *"@sha256:"* ]]; then
        # Handle @sha256 case
            IMAGE_REPO=$(echo $image | cut -d'@' -f1)
            IMAGE_TAG=$(echo $image | cut -d'@' -f2)

        elif [[ $image == *":"* ]]; then
            # Handle :tag case
            IMAGE_REPO=$(echo $image | cut -d':' -f1)
            IMAGE_TAG=$(echo $image | cut -d':' -f 2 )
        else
            # If neither @ nor : is present, use the full string
            IMAGE_REPO=$image
        fi
        if [ "$ARCH" == "arm64" ]; then
            docker run --platform linux/amd64 --user 0:0 \
            -v ${HOME}/.docker/config.json:/root/.docker/config.json \
            -v /var/run/docker.sock:/var/run/docker.sock \
            --rm "$AWS_REPO":"$FALCON_IMAGE_TAG" \
            falconutil patch-image \
            --cid $FALCON_CID \
            --falcon-image-uri "$AWS_REPO":"$FALCON_IMAGE_TAG" \
            --source-image-uri "$IMAGE_REPO":"$IMAGE_TAG" \
            --target-image-uri "$IMAGE_REPO":patched \
            --image-pull-policy IfNotPresent \
            --falconctl-opts "--tags=$FALCON_TAG"
        else
            docker run --platform linux --user 0:0 \
            -v ${HOME}/.docker/config.json:/root/.docker/config.json \
            -v /var/run/docker.sock:/var/run/docker.sock \
            --rm "$AWS_REPO":"$FALCON_IMAGE_TAG" \
            falconutil patch-image \
            --cid $FALCON_CID \
            --falcon-image-uri "$AWS_REPO":"$FALCON_IMAGE_TAG" \
            --source-image-uri "$IMAGE_REPO":"$IMAGE_TAG" \
            --target-image-uri "$IMAGE_REPO":patched \
            --image-pull-policy IfNotPresent \
            --falconctl-opts "--tags=$FALCON_TAG"
        fi

        echo ""
        echo "Pushing patched image "$IMAGE_REPO":patched to AWS"

        # Push new patched image to registry
        PATCHED_IMAGE="$IMAGE_REPO":patched
        push_images=$(docker push "$PATCHED_IMAGE")


        CONTAINER_COUNT=$(echo $images | wc -w)
        # Create a new task definition revision with the new image
        for ((i=0; i<$CONTAINER_COUNT; i++)); do
        jq --arg index $i --arg new_image "$PATCHED_IMAGE" '
            .containerDefinitions[$index | tonumber].image = $new_image
        ' $cleaned_file > $selected_service/${task_def_name}-temp-patched.json && mv $selected_service/${task_def_name}-temp-patched.json $selected_service/${task_def_name}-patched.json
        done

    done
    # Remove cleaned file
    rm -f $cleaned_file

    echo "Registering patched task definition on AWS"
    task_register=$(aws ecs register-task-definition --region $region --cli-input-json file://$selected_service/${task_def_name}-patched.json)

} || handle_error "Failed to update task definition"