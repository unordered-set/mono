/* global web3 artifacts */
const {interestAprAsBN, TRANCHES, OWNER_ROLE, PAUSER_ROLE, ETHDecimals} = require("../blockchain_scripts/deployHelpers")
const {CONFIG_KEYS} = require("../blockchain_scripts/configKeys")
const hre = require("hardhat")
const {deployments} = hre
const {
  expect,
  BN,
  getBalance,
  deployAllContracts,
  erc20Transfer,
  erc20Approve,
  expectAction,
  decimals,
  USDC_DECIMALS,
  usdcVal,
  createPoolWithCreditLine,
} = require("./testHelpers.js")
let accounts, owner, person2, person3, reserve, borrower
const WITHDRAWL_FEE_DENOMINATOR = new BN(200)

describe("SeniorFund", () => {
  let seniorFund, seniorFundStrategy, usdc, fidu, goldfinchConfig, tranchedPool
  let juniorInvestmentAmount = usdcVal(10000)
  let depositAmount = new BN(4).mul(USDC_DECIMALS)
  let withdrawAmount = new BN(2).mul(USDC_DECIMALS)
  const decimalsDelta = decimals.div(USDC_DECIMALS)

  let makeDeposit = async (person, amount) => {
    amount = amount || depositAmount
    person = person || person2
    return await seniorFund.deposit(String(amount), {from: person})
  }
  let makeWithdraw = async (person, usdcAmount) => {
    usdcAmount = usdcAmount || withdrawAmount
    person = person || person2
    return await seniorFund.withdraw(usdcAmount, {from: person})
  }

  let makeWithdrawInFidu = async (person, fiduAmount) => {
    return await seniorFund.withdrawInFidu(fiduAmount, {from: person})
  }

  const setupTest = deployments.createFixture(async ({deployments}) => {
    const {
      seniorFund,
      seniorFundStrategy,
      usdc,
      seniorFundFidu: fidu,
      goldfinchFactory,
      goldfinchConfig,
    } = await deployAllContracts(deployments)
    // A bit of setup for our test users
    await erc20Approve(usdc, seniorFund.address, usdcVal(100000), [person2])
    await erc20Transfer(usdc, [person2, person3], usdcVal(10000), owner)
    await goldfinchConfig.setTreasuryReserve(reserve)

    await goldfinchConfig.bulkAddToGoList([owner, person2, person3, reserve, seniorFund.address])

    juniorInvestmentAmount = usdcVal(10000)
    let limit = juniorInvestmentAmount.mul(new BN(10))
    let interestApr = interestAprAsBN("5.00")
    let paymentPeriodInDays = new BN(30)
    let termInDays = new BN(365)
    let lateFeeApr = new BN(0)
    let juniorFeePercent = new BN(20)
    ;({tranchedPool} = await createPoolWithCreditLine({
      people: {owner, borrower},
      goldfinchFactory,
      limit,
      interestApr,
      paymentPeriodInDays,
      termInDays,
      lateFeeApr,
      juniorFeePercent,
      usdc,
    }))

    await tranchedPool.deposit(TRANCHES.Junior, juniorInvestmentAmount)

    return {usdc, seniorFund, seniorFundStrategy, tranchedPool, fidu, goldfinchConfig}
  })

  beforeEach(async () => {
    // Pull in our unlocked accounts
    accounts = await web3.eth.getAccounts()
    ;[owner, person2, person3, reserve] = accounts
    borrower = person2
    ;({usdc, seniorFund, seniorFundStrategy, tranchedPool, fidu, goldfinchConfig} = await setupTest())
  })

  describe("Access Controls", () => {
    it("sets the owner", async () => {
      expect(await seniorFund.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await seniorFund.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE)
    })

    it("sets the pauser", async () => {
      expect(await seniorFund.hasRole(PAUSER_ROLE, owner)).to.equal(true)
      expect(await seniorFund.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE)
    })

    it("allows the owner to set new addresses as roles", async () => {
      expect(await seniorFund.hasRole(OWNER_ROLE, person2)).to.equal(false)
      await seniorFund.grantRole(OWNER_ROLE, person2, {from: owner})
      expect(await seniorFund.hasRole(OWNER_ROLE, person2)).to.equal(true)
    })

    it("should not allow anyone else to add an owner", async () => {
      return expect(seniorFund.grantRole(OWNER_ROLE, person2, {from: person3})).to.be.rejected
    })
  })

  describe("Pausability", () => {
    describe("after pausing", async () => {
      beforeEach(async () => {
        await makeDeposit()
        await seniorFund.pause()
      })
      it("disallows deposits", async () => {
        return expect(makeDeposit()).to.be.rejectedWith(/Pausable: paused/)
      })
      it("disallows withdrawing", async () => {
        return expect(makeWithdraw()).to.be.rejectedWith(/Pausable: paused/)
      })
      it("allows unpausing", async () => {
        await seniorFund.unpause()
        return expect(makeDeposit()).to.be.fulfilled
      })
    })

    describe("actually pausing", async () => {
      it("should allow the owner to pause", async () => {
        return expect(seniorFund.pause()).to.be.fulfilled
      })
      it("should disallow non-owner to pause", async () => {
        return expect(seniorFund.pause({from: person2})).to.be.rejectedWith(/Must have pauser role/)
      })
    })
  })

  describe("updateGoldfinchConfig", () => {
    describe("setting it", async () => {
      it("should allow the owner to set it", async () => {
        await goldfinchConfig.setAddress(CONFIG_KEYS.GoldfinchConfig, person2)
        return expectAction(() => seniorFund.updateGoldfinchConfig({from: owner})).toChange([
          [() => seniorFund.config(), {to: person2}],
        ])
      })
      it("should disallow non-owner to set", async () => {
        return expect(seniorFund.updateGoldfinchConfig({from: person2})).to.be.rejectedWith(/Must have admin/)
      })
    })
  })

  describe("deposit", () => {
    describe("before you have approved the fund to transfer funds on your behalf", async () => {
      it("should fail", async () => {
        const expectedErr = "VM Exception while processing transaction: revert ERC20: transfer amount exceeds allowance"
        return expect(makeDeposit(person3)).to.be.rejectedWith(expectedErr)
      })
    })

    describe("after you have approved the fund to transfer funds", async () => {
      let capitalProvider
      beforeEach(async () => {
        await usdc.approve(seniorFund.address, new BN(100000).mul(USDC_DECIMALS), {from: person2})
        await usdc.approve(seniorFund.address, new BN(100000).mul(USDC_DECIMALS), {from: owner})
        capitalProvider = person2
      })

      it("increases the fund's balance of the ERC20 token when you call deposit", async () => {
        const balanceBefore = await getBalance(seniorFund.address, usdc)
        await makeDeposit()
        const balanceAfter = await getBalance(seniorFund.address, usdc)
        const delta = balanceAfter.sub(balanceBefore)
        expect(delta).to.bignumber.equal(depositAmount)
      })

      it("decreases the depositors balance of the ERC20 token when you call deposit", async () => {
        const balanceBefore = await getBalance(capitalProvider, usdc)
        await makeDeposit()
        const balanceAfter = await getBalance(capitalProvider, usdc)
        const delta = balanceBefore.sub(balanceAfter)
        expect(delta).to.bignumber.equal(depositAmount)
      })

      it("gives the depositor the correct amount of Fidu", async () => {
        await makeDeposit()
        const fiduBalance = await getBalance(person2, fidu)
        expect(fiduBalance).to.bignumber.equal(depositAmount.mul(decimalsDelta))
      })

      it("tracks other accounting correctly on Fidu", async () => {
        const totalSupplyBefore = await fidu.totalSupply()
        await makeDeposit()
        const totalSupplyAfter = await fidu.totalSupply()
        expect(totalSupplyAfter.sub(totalSupplyBefore)).to.bignumber.equal(depositAmount.mul(decimalsDelta))
      })

      it("emits an event with the correct data", async () => {
        const result = await makeDeposit()
        const event = result.logs[0]

        expect(event.event).to.equal("DepositMade")
        expect(event.args.capitalProvider).to.equal(capitalProvider)
        expect(event.args.amount).to.bignumber.equal(depositAmount)
        expect(event.args.shares).to.bignumber.equal(depositAmount.mul(decimalsDelta))
      })

      it("increases the totalShares, even when two different people deposit", async () => {
        const secondDepositAmount = new BN(1).mul(USDC_DECIMALS)
        await makeDeposit()
        await makeDeposit(owner, secondDepositAmount)
        const totalShares = await fidu.totalSupply()
        const totalDeposited = depositAmount.mul(decimalsDelta).add(secondDepositAmount.mul(decimalsDelta))
        expect(totalShares).to.bignumber.equal(totalDeposited)
      })
    })
  })

  describe("getNumShares", () => {
    it("calculates correctly", async () => {
      const amount = 3000
      const sharePrice = await seniorFund.sharePrice()
      const numShares = await seniorFund._getNumShares(amount)
      expect(numShares).to.bignumber.equal(
        new BN(amount).mul(decimals.div(USDC_DECIMALS)).mul(decimals).div(sharePrice)
      )
    })
  })

  describe("withdraw", () => {
    let capitalProvider
    beforeEach(async () => {
      await usdc.approve(seniorFund.address, new BN(100000).mul(USDC_DECIMALS), {from: person2})
      await usdc.approve(seniorFund.address, new BN(100000).mul(USDC_DECIMALS), {from: owner})

      capitalProvider = person2
    })

    it("withdraws the correct amount of value from the contract when you call withdraw", async () => {
      await makeDeposit()
      const balanceBefore = await getBalance(seniorFund.address, usdc)
      await makeWithdraw()
      const balanceAfter = await getBalance(seniorFund.address, usdc)
      const delta = balanceBefore.sub(balanceAfter)
      expect(delta).to.bignumber.equal(withdrawAmount)
    })

    it("emits an event with the correct data", async () => {
      await makeDeposit()
      const result = await makeWithdraw()
      const event = result.logs[0]
      const reserveAmount = withdrawAmount.div(new BN(200))

      expect(event.event).to.equal("WithdrawalMade")
      expect(event.args.capitalProvider).to.equal(capitalProvider)
      expect(event.args.reserveAmount).to.bignumber.equal(reserveAmount)
      expect(event.args.userAmount).to.bignumber.equal(withdrawAmount.sub(reserveAmount))
    })

    it("should emit an event that the reserve received funds", async () => {
      await makeDeposit()
      const result = await makeWithdraw()
      const event = result.logs[1]

      expect(event.event).to.equal("ReserveFundsCollected")
      expect(event.args.user).to.equal(capitalProvider)
      expect(event.args.amount).to.bignumber.equal(withdrawAmount.div(WITHDRAWL_FEE_DENOMINATOR))
    })

    it("sends the amount back to the address, accounting for fees", async () => {
      await makeDeposit()
      const addressValueBefore = await getBalance(person2, usdc)
      await makeWithdraw()
      const addressValueAfter = await getBalance(person2, usdc)
      const expectedFee = withdrawAmount.div(WITHDRAWL_FEE_DENOMINATOR)
      const delta = addressValueAfter.sub(addressValueBefore)
      expect(delta).bignumber.equal(withdrawAmount.sub(expectedFee))
    })

    it("should send the fees to the reserve address", async () => {
      await makeDeposit()
      const reserveBalanceBefore = await getBalance(reserve, usdc)
      await makeWithdraw()
      const reserveBalanceAfter = await getBalance(reserve, usdc)
      const expectedFee = withdrawAmount.div(WITHDRAWL_FEE_DENOMINATOR)
      const delta = reserveBalanceAfter.sub(reserveBalanceBefore)
      expect(delta).bignumber.equal(expectedFee)
    })

    it("reduces your shares of fidu", async () => {
      await makeDeposit()
      const balanceBefore = await getBalance(person2, fidu)
      await makeWithdraw()
      const balanceAfter = await getBalance(person2, fidu)
      const expectedShares = balanceBefore.sub(withdrawAmount.mul(decimals).div(USDC_DECIMALS))
      expect(balanceAfter).to.bignumber.equal(expectedShares)
    })

    it("decreases the totalSupply of Fidu", async () => {
      await makeDeposit()
      const sharesBefore = await fidu.totalSupply()
      await makeWithdraw()
      const sharesAfter = await fidu.totalSupply()
      const expectedShares = sharesBefore.sub(withdrawAmount.mul(decimals.div(USDC_DECIMALS)))
      expect(sharesAfter).to.bignumber.equal(expectedShares)
    })

    it("lets you withdraw in fidu terms", async () => {
      await makeDeposit()
      const fiduBalance = await getBalance(person2, fidu)
      expect(fiduBalance).to.bignumber.gt("0")

      await expectAction(() => {
        return makeWithdrawInFidu(person2, fiduBalance)
      }).toChange([
        [() => getBalance(person2, usdc), {byCloseTo: usdcVal(4)}], // Not exactly the same as input due to fees
        [() => getBalance(person2, fidu), {to: new BN(0)}], // All fidu deducted
        [() => getBalance(seniorFund.address, usdc), {to: new BN(0)}], // Should have removed the full balance
        [() => fidu.totalSupply(), {by: fiduBalance.neg()}], // Fidu has been burned
      ])
    })

    it("prevents you from withdrawing more than you have", async () => {
      const expectedErr = /Amount requested is greater than what this address owns/
      await expect(makeWithdraw()).to.be.rejectedWith(expectedErr)
      await expect(makeWithdrawInFidu(person2, withdrawAmount)).to.be.rejectedWith(expectedErr)
    })

    it("it lets you withdraw your exact total holdings", async () => {
      await makeDeposit(person2, 123)
      await makeWithdraw(person2, 123)
      const sharesAfter = await getBalance(person2, fidu)
      expect(sharesAfter.toNumber()).to.equal(0)
    })
  })

  describe("hard limits", async () => {
    describe("totalFundsLimit", async () => {
      describe("once it's set", async () => {
        let limit = new BN(5000)
        beforeEach(async () => {
          await goldfinchConfig.setNumber(CONFIG_KEYS.TotalFundsLimit, limit.mul(USDC_DECIMALS))
          await goldfinchConfig.setNumber(CONFIG_KEYS.TransactionLimit, limit.mul(new BN(2)).mul(USDC_DECIMALS))
        })

        it("should accept deposits before the limit is reached", async () => {
          return expect(makeDeposit(person2, new BN(1000).mul(USDC_DECIMALS))).to.be.fulfilled
        })

        it("should accept everything right up to the limit", async () => {
          return expect(makeDeposit(person2, new BN(limit).mul(USDC_DECIMALS))).to.be.fulfilled
        })

        it("should fail if you're over the limit", async () => {
          return expect(makeDeposit(person2, new BN(limit).add(new BN(1)).mul(USDC_DECIMALS))).to.be.rejectedWith(
            /put the fund over the total limit/
          )
        })
      })
    })
    describe("transactionLimit", async () => {
      describe("after setting it", async () => {
        let limit
        beforeEach(async () => {
          limit = new BN(1000)
          await goldfinchConfig.setNumber(CONFIG_KEYS.TotalFundsLimit, limit.mul(new BN(10)).mul(USDC_DECIMALS))
          await goldfinchConfig.setNumber(CONFIG_KEYS.TransactionLimit, limit.mul(USDC_DECIMALS))
        })

        it("should still allow transactions up to the limit", async () => {
          return expect(makeDeposit(person2, new BN(limit).mul(USDC_DECIMALS))).to.be.fulfilled
        })

        it("should block deposits over the limit", async () => {
          return expect(makeDeposit(person2, new BN(limit).add(new BN(1)).mul(USDC_DECIMALS))).to.be.rejectedWith(
            /Amount is over the per-transaction limit/
          )
        })

        it("should block withdrawals over the limit", async () => {
          await makeDeposit(person2, new BN(limit).mul(USDC_DECIMALS))
          await makeDeposit(person2, new BN(limit).mul(USDC_DECIMALS))

          return expect(makeWithdraw(person2, new BN(limit).add(new BN(1)).mul(USDC_DECIMALS))).to.be.rejectedWith(
            /Amount is over the per-transaction limit/
          )
        })
      })
    })
  })

  describe("assets matching liabilities", async () => {
    describe("when there is a super tiny rounding error", async () => {
      it("should still work", async () => {
        // This share price will cause a rounding error of 1 atomic unit.
        var testSharePrice = new BN(String(1.23456789 * ETHDecimals))
        await seniorFund._setSharePrice(testSharePrice)

        return expect(makeDeposit(person2, new BN(2500).mul(USDC_DECIMALS))).to.be.fulfilled
      })
    })
  })

  describe("USDC Mantissa", async () => {
    it("should equal 1e6", async () => {
      expect(await seniorFund._usdcMantissa()).to.bignumber.equal(USDC_DECIMALS)
    })
  })

  describe("Fidu Mantissa", async () => {
    it("should equal 1e18", async () => {
      expect(await seniorFund._fiduMantissa()).to.bignumber.equal(decimals)
    })
  })

  describe("usdcToFidu", async () => {
    it("should equal 1e12", async () => {
      expect(await seniorFund._usdcToFidu(new BN(1))).to.bignumber.equal(new BN(1e12))
    })
  })

  describe("invest", () => {
    beforeEach(async () => {
      await erc20Approve(usdc, seniorFund.address, usdcVal(100000), [owner])
      await makeDeposit(owner, usdcVal(100000))
    })

    context("Pool is not valid", () => {
      it("reverts", async () => {
        // Simulate someone deploying their own malicious TranchedPool using our contracts
        let accountant = await deployments.deploy("Accountant", {from: person2, gas: 4000000, args: []})
        let poolDeployResult = await deployments.deploy("TranchedPool", {
          from: person2,
          gas: 4000000,
          libraries: {["Accountant"]: accountant.address},
        })
        let unknownPool = await artifacts.require("TranchedPool").at(poolDeployResult.address)
        let creditLineResult = await deployments.deploy("CreditLine", {
          from: person2,
          gas: 4000000,
          libraries: {["Accountant"]: accountant.address},
        })
        let creditLine = await artifacts.require("CreditLine").at(creditLineResult.address)
        await creditLine.initialize(
          goldfinchConfig.address,
          person2,
          person2,
          usdcVal(1000),
          interestAprAsBN(0),
          new BN(1),
          new BN(10),
          interestAprAsBN(0)
        )
        await unknownPool.initialize(
          goldfinchConfig.address,
          person2,
          new BN(20),
          usdcVal(1000),
          interestAprAsBN(0),
          new BN(1),
          new BN(10),
          interestAprAsBN(0)
        )
        await unknownPool.lockJuniorCapital({from: person2})

        await expect(seniorFund.invest(unknownPool.address)).to.be.rejectedWith(/Pool must be valid/)
      })
    })

    context("strategy amount is > 0", () => {
      it("should deposit amount into the pool", async () => {
        // Make the strategy invest
        await tranchedPool.lockJuniorCapital({from: borrower})
        let investmentAmount = await seniorFundStrategy.invest(seniorFund.address, tranchedPool.address)

        await expectAction(async () => await seniorFund.invest(tranchedPool.address)).toChange([
          [async () => await getBalance(seniorFund.address, usdc), {by: investmentAmount.neg()}],
        ])
      })

      it("should emit an event", async () => {
        // Make the strategy invest
        await tranchedPool.lockJuniorCapital({from: borrower})
        let investmentAmount = await seniorFundStrategy.invest(seniorFund.address, tranchedPool.address)

        let receipt = await seniorFund.invest(tranchedPool.address)
        let event = receipt.logs[0]

        expect(event.event).to.equal("InvestmentMade")
        expect(event.args.tranchedPool).to.equal(tranchedPool.address)
        expect(event.args.amount).to.bignumber.equal(investmentAmount)
      })
    })

    context("strategy amount is 0", async () => {
      it("reverts", async () => {
        // Junior tranche is still open, so investment amount should be 0
        let investmentAmount = await seniorFundStrategy.invest(seniorFund.address, tranchedPool.address)
        expect(investmentAmount).to.bignumber.equal(new BN(0))

        await expect(seniorFund.invest(tranchedPool.address)).to.be.rejectedWith(/amount must be positive/)
      })
    })
  })

  // TODO
  describe("redeem", async () => {
    it("should redeem the maximum from the TranchedPool", async () => {})

    it("should adjust the share price accounting for new interest redeemed", async () => {})

    it("should emit an event", async () => {})
  })

  // TODO
  describe("writedown", async () => {
    it("should adjust the share price accounting for lost principal", async () => {})

    it("should emit an event", async () => {})

    context("Pool is not valid", () => {
      it("reverts", async () => {})
    })
  })
})
