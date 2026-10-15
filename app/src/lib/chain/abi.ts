// Generated from contracts/src/interfaces/ITreasuryPolicy.sol (forge build). Regenerate with: npm run abi
export const treasuryPolicyAbi = [
  {
    "type": "function",
    "name": "agent",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "approveProposal",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "auditPayment",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cleared",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "executed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "auditor",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "budget",
    "inputs": [
      {
        "name": "lineId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ITreasuryPolicy.Budget",
        "components": [
          {
            "name": "allocated",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "spent",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "periodEnd",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "exists",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "budgetLines",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "configHash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "contribute",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "ref",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executePayment",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hasApproved",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasApprovedProposal",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "invoiceIdOf",
    "inputs": [
      {
        "name": "invoice",
        "type": "tuple",
        "internalType": "struct ITreasuryPolicy.Invoice",
        "components": [
          {
            "name": "cuit",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "tipo",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "ptoVta",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "nro",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "invoicePaid",
    "inputs": [
      {
        "name": "invoiceId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isSigner",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "payment",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ITreasuryPolicy.Payment",
        "components": [
          {
            "name": "vendor",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lineId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "invoiceId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "fileHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum ITreasuryPolicy.PaymentStatus"
          },
          {
            "name": "approvals",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paymentAudit",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum ITreasuryPolicy.AuditStatus"
      },
      {
        "name": "reportHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paymentCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "perTxCap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposal",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "enum ITreasuryPolicy.ProposalKind"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proposer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "executed",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "approvals",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposalCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "propose",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "enum ITreasuryPolicy.ProposalKind"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "proposePayment",
    "inputs": [
      {
        "name": "vendor",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "invoice",
        "type": "tuple",
        "internalType": "struct ITreasuryPolicy.Invoice",
        "components": [
          {
            "name": "cuit",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "tipo",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "ptoVta",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "nro",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "lineId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "fileHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "executed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reject",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "signerEpoch",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "signers",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "threshold",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "vendorCuit",
    "inputs": [
      {
        "name": "vendor",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "cuit",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "enabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "vendorMonthlyCap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "vendorSpentThisPeriod",
    "inputs": [
      {
        "name": "vendor",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AgentSet",
    "inputs": [
      {
        "name": "agent",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AuditorSet",
    "inputs": [
      {
        "name": "auditor",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BudgetMoved",
    "inputs": [
      {
        "name": "fromLine",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "toLine",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BudgetSet",
    "inputs": [
      {
        "name": "lineId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "allocated",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "periodEnd",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CapsSet",
    "inputs": [
      {
        "name": "perTxCap",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "vendorMonthlyCap",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ConfigHashSet",
    "inputs": [
      {
        "name": "configHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Contribution",
    "inputs": [
      {
        "name": "ref",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "by",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentApproved",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "signer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "approvals",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentAudited",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "auditor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "cleared",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "reportHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentExecuted",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "vendor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "lineId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "invoiceId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "fileHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "rule",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ITreasuryPolicy.Rule"
      },
      {
        "name": "overBudget",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "budgetExpired",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentProposed",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "vendor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "lineId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "invoiceId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "fileHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentRejected",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "signer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProposalApproved",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "signer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "approvals",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProposalCreated",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "proposer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ITreasuryPolicy.ProposalKind"
      },
      {
        "name": "data",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProposalExecuted",
    "inputs": [
      {
        "name": "proposalId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum ITreasuryPolicy.ProposalKind"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SignersSet",
    "inputs": [
      {
        "name": "signers",
        "type": "address[]",
        "indexed": false,
        "internalType": "address[]"
      },
      {
        "name": "threshold",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VendorSet",
    "inputs": [
      {
        "name": "vendor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "cuit",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  }
] as const;

export const boxFactoryAbi = [
  {
    "type": "function",
    "name": "boxAddress",
    "inputs": [
      {
        "name": "ref",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sweep",
    "inputs": [
      {
        "name": "ref",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "token",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "treasury",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "BoxSwept",
    "inputs": [
      {
        "name": "ref",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "box",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const;
