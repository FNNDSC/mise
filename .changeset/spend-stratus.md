---
"@fnndsc/stratus": minor
---

What each domain costs can now be read from the session: spend prices its machines, volumes and load balancers. Machines are priced by vCPU and memory while they run, volumes by size and performance, load balancers by the hour and their minimum bandwidth, as harbor-oci's burn did. Each line gives the rate an hour and what it has come to since the resource was made, then the domain's total; it is an estimate, not the bill. `domain status` carries the same cost in a line and in its model. The OCI driver now reads an instance's OCPUs and memory, a volume's performance units and a load balancer's minimum bandwidth, and the storage and balancer parts of Oracle's price list.
