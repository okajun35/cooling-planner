import * as cdk from 'aws-cdk-lib';
import {CoolingPlannerStack} from '../lib/stack.js';

const app=new cdk.App();
new CoolingPlannerStack(app,'CoolingPlanner',{
 env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION},
});
