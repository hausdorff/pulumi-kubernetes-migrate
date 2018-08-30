import * as fs from "fs";
import * as mkdirp from "mkdirp";
import * as os from "os";
import * as proc from "child_process";
import * as path from "path";
import * as glob from "glob";
import * as rx from "rxjs";
import { map, filter, distinct, groupBy, flatMap, toArray } from "rxjs/operators";

//
// Obtain all checkpoint files.
//

// const checkpoints = fs.readFileSync("checkpoint_files.txt").toString();
// checkpoints
//     .split(os.EOL)
//     .forEach((line, i) => {
//         console.log(i);
//         const checkpointPath = line.split("|", 2)[0].trim();
//         const dir = path.dirname(checkpointPath);
//         mkdirp.sync(dir);
//         proc.exec(`aws s3 cp s3://checkpoint-bucket-8c4bf2b/${checkpointPath} ./${dir}`);
//     });

function emails(file: string) {
    const checkpoints = fs.readFileSync(file).toString();
    const files: { [key: string]: string } = {};
    checkpoints.split(os.EOL).forEach(line => {
        const split = line.split("|");
        const checkpointPath = split[0].trim();
        const email = split[2].trim();
        // const dir = path.dirname(checkpointPath);
        files[checkpointPath] = email;
    });

    return files;
}

const rawEmails = emails("checkpoint_files.txt");
const kubeEmails = rx.Observable.of(...glob.sync("checkpoints/**/*.json"))
    .map(file => {
        const text = fs.readFileSync(`./${file}`).toString();
        const stack = JSON.parse(text);
        const email = rawEmails[file];
        return { text, stack, file, email };
    })
    .filter(({ text, stack, file }) => {
        return (
            text.includes("kubernetes") &&
            stack.deployment &&
            stack.deployment.resources &&
            stack.deployment.resources.length > 1
        );
    })
    .groupBy(({ email }) => email)
    .forEach(group => {
        group.toArray().forEach(stacks => {
            const email = group.key;
            if (email == "NULL") {
                return;
            }

            stacks.forEach(({ file, stack }) => {
                console.log(`\t${file}`);
                let stackName = "";
                stack.deployment.resources.forEach((resc: any) => {
                    if (resc.type == "pulumi:pulumi:Stack") {
                        const urn = resc.urn.split("::");
                        stackName = urn[urn.length - 1];
                        console.log(`\t\t${stackName}`);
                    }
                });

                for (const resc of stack.deployment.resources) {
                    if (resc.type == "pulumi:pulumi:Stack") {
                        continue;
                    }
                    if (resc.id === undefined) {
                        continue;
                    }
                    if (!resc.type.startsWith("kubernetes")) {
                        continue;
                    }

                    const id = resc.id.split(".");
                    if (id && id.length == 2) {
                        // console.log(`\t\t\t${resc.id}\t${resc.type}`);
                        console.log(`\t\t\t${id.join("/")}`);
                        resc.id = id.join("/");
                    }
                }

                const emailDir = `fixed/${email}`;
                mkdirp.sync(emailDir);

                fs.writeFileSync(
                    `${emailDir}/${stackName}`,
                    JSON.stringify(stack, undefined, "  ")
                );
            });
        });
    });
